// ============================================================
// CONSISTENCY SERVICE — The Heart of CP Guarantees
// ============================================================
// This service implements the CP (Consistency + Partition
// Tolerance) layer of the system. It manages:
//
// 1. NODE REGISTRATION — each app instance registers in the
//    ClusterNode table on startup.
// 2. HEARTBEAT — periodic heartbeats prove liveness to peers.
// 3. HEALTH CHECKS — determines if a quorum of nodes exists.
// 4. LEADER ELECTION — a leased singleton lock ensures exactly
//    one leader runs scheduled tasks at a time.
// 5. STALE NODE DETECTION — removes dead nodes from the registry.
//
// CAP Decision:
// During a network partition (or when quorum is lost), the
// system REFUSES to process tasks rather than risk executing
// with inconsistent state. All task operations check
// requireHealthy() first. This is the CP trade-off:
// we sacrifice Availability to guarantee Consistency.
// ============================================================

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PartitionException } from '../../common/exceptions/partition.exception';

export enum ClusterHealth {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  PARTITIONED = 'PARTITIONED',
}

export interface ClusterHealthSnapshot {
  health: ClusterHealth;
  checkedAt: Date;
  databaseReachable: boolean;
  writeSafe: boolean;
  selfRegistered: boolean;
  aliveNodeCount: number;
  requiredNodeCount: number;
  nodeQuorumMet: boolean;
  schedulerLeaseOwnerId: string | null;
  schedulerLeaseExpiresAt: Date | null;
  schedulerReady: boolean;
  isLeader: boolean;
}

@Injectable()
export class ConsistencyService implements OnModuleInit, OnModuleDestroy {
  private static readonly SCHEDULER_LEASE = 'scheduler';

  private readonly logger = new Logger(ConsistencyService.name);
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private currentHealth: ClusterHealth = ClusterHealth.PARTITIONED;
  private isLeader = false;
  private healthSnapshot: ClusterHealthSnapshot;

  private readonly instanceId: string;
  private readonly heartbeatIntervalMs: number;
  private readonly nodeTimeoutMs: number;
  private readonly leaderLeaseMs: number;
  private readonly minNodes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.instanceId = this.config.get<string>('app.instanceId')!;
    this.heartbeatIntervalMs = this.config.get<number>(
      'app.clusterHeartbeatIntervalMs',
    )!;
    this.nodeTimeoutMs = this.config.get<number>('app.clusterNodeTimeoutMs')!;
    this.leaderLeaseMs = this.config.get<number>('app.clusterLeaderLeaseMs')!;
    this.minNodes = this.config.get<number>('app.clusterMinNodes')!;
    this.healthSnapshot = this.createPartitionedSnapshot();
  }

  async onModuleInit() {
    await this.registerNode();
    this.startHeartbeat();
    // Initial health check after a brief delay for DB stabilization
    setTimeout(() => {
      void this.sendHeartbeat();
    }, 2000);
  }

  async onModuleDestroy() {
    this.stopHeartbeat();
    await this.releaseLeadership().catch((error) => {
      this.logger.warn('Failed to release leadership during shutdown', error);
    });
  }

  // ── Node Registration ──────────────────────────────────

  /** Register this instance in the cluster node table */
  async registerNode(now = new Date()): Promise<void> {
    await this.prisma.clusterNode.upsert({
      where: { id: this.instanceId },
      update: {
        lastHeartbeat: now,
        metadata: { pid: process.pid },
      },
      create: {
        id: this.instanceId,
        lastHeartbeat: now,
        startedAt: now,
        metadata: { pid: process.pid },
      },
    });
    this.logger.log(`Node registered: ${this.instanceId}`);
  }

  // ── Heartbeat ──────────────────────────────────────────

  /** Send a heartbeat, clean stale nodes, refresh health, and attempt leader election */
  async sendHeartbeat(): Promise<void> {
    try {
      const now = new Date();

      await this.registerNode(now);

      // Remove nodes that haven't sent a heartbeat within the timeout
      const cutoff = new Date(now.getTime() - this.nodeTimeoutMs);
      await this.prisma.clusterNode.deleteMany({
        where: {
          id: { not: this.instanceId },
          lastHeartbeat: { lt: cutoff },
        },
      });

      // Attempt to become leader if no active leader exists
      await this.tryBecomeLeader(now);

      // Refresh cluster health assessment after any lease change
      await this.refreshHealth(now);
    } catch (error) {
      this.logger.error(
        'Heartbeat failed — marking cluster as PARTITIONED',
        error,
      );
      this.healthSnapshot = this.createPartitionedSnapshot();
      this.currentHealth = this.healthSnapshot.health;
      this.isLeader = false;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeat(),
      this.heartbeatIntervalMs,
    );
    this.logger.log(
      `Heartbeat started (every ${this.heartbeatIntervalMs}ms)`,
    );
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Health Checks ──────────────────────────────────────

  /** Assess cluster health by counting alive nodes */
  async checkHealth(forceRefresh = true): Promise<ClusterHealth> {
    const snapshot = await this.getHealthSnapshot(forceRefresh);
    return snapshot.health;
  }

  async getHealthSnapshot(
    forceRefresh = false,
  ): Promise<ClusterHealthSnapshot> {
    if (!forceRefresh) {
      return this.healthSnapshot;
    }

    return this.refreshHealth();
  }

  private async refreshHealth(now = new Date()): Promise<ClusterHealthSnapshot> {
    try {
      const cutoff = new Date(now.getTime() - this.nodeTimeoutMs);
      await this.prisma.$queryRaw`SELECT 1`;

      const [selfNode, aliveCount, lease] = await Promise.all([
        this.prisma.clusterNode.findUnique({
          where: { id: this.instanceId },
          select: { id: true },
        }),
        this.prisma.clusterNode.count({
          where: { lastHeartbeat: { gte: cutoff } },
        }),
        this.prisma.clusterLease.findUnique({
          where: { name: ConsistencyService.SCHEDULER_LEASE },
          select: { ownerId: true, leaseUntil: true },
        }),
      ]);

      const schedulerLeaseActive =
        !!lease && lease.leaseUntil.getTime() > now.getTime();
      const schedulerReady =
        schedulerLeaseActive && lease.ownerId === this.instanceId;
      const selfRegistered = !!selfNode;
      const requiredNodeCount = Math.max(this.minNodes, 1);
      const nodeQuorumMet = aliveCount >= requiredNodeCount;
      const writeSafe = selfRegistered;

      let health = ClusterHealth.HEALTHY;
      if (!writeSafe) {
        health = ClusterHealth.DEGRADED;
      } else if (!nodeQuorumMet || (aliveCount > 1 && !schedulerLeaseActive)) {
        health = ClusterHealth.DEGRADED;
      }

      this.isLeader = schedulerReady;
      this.currentHealth = health;
      this.healthSnapshot = {
        health,
        checkedAt: now,
        databaseReachable: true,
        writeSafe,
        selfRegistered,
        aliveNodeCount: aliveCount,
        requiredNodeCount,
        nodeQuorumMet,
        schedulerLeaseOwnerId: lease?.ownerId ?? null,
        schedulerLeaseExpiresAt: lease?.leaseUntil ?? null,
        schedulerReady,
        isLeader: schedulerReady,
      };

      return this.healthSnapshot;
    } catch {
      this.healthSnapshot = this.createPartitionedSnapshot(now);
      this.currentHealth = this.healthSnapshot.health;
      this.isLeader = false;
      return this.healthSnapshot;
    }
  }

  /** Get current cluster health (cached from last heartbeat cycle) */
  getHealth(): ClusterHealth {
    return this.healthSnapshot.health;
  }

  /**
   * Require a healthy cluster before proceeding.
   * Throws PartitionException if cluster is not healthy.
   *
   * This is the CP gate — operations are REJECTED during
   * partitions rather than risk stale/inconsistent execution.
   */
  async requireHealthy(): Promise<void> {
    const snapshot = await this.getHealthSnapshot(true);
    if (!snapshot.writeSafe) {
      throw new PartitionException(
        `Cluster health is ${snapshot.health}. ` +
          'Database quorum or node registration is unavailable. ' +
          'Operation rejected to maintain CP consistency.',
      );
    }
  }

  async hasLeadership(): Promise<boolean> {
    const snapshot = await this.getHealthSnapshot(true);
    return snapshot.schedulerReady;
  }

  // ── Leader Election ────────────────────────────────────

  /**
  * Attempt to become the cluster leader using a leased singleton lock.
   *
   * Leader election ensures exactly ONE instance runs the
   * scheduler. Without this, multiple instances would evaluate
   * the same schedules and create duplicate tasks — violating CP.
   */
  private async tryBecomeLeader(now = new Date()): Promise<void> {
    try {
      const leaseUntil = new Date(now.getTime() + this.leaderLeaseMs);
      const acquired = await this.prisma.$transaction(async (tx) => {
        await tx.clusterLease.createMany({
          data: [
            {
              name: ConsistencyService.SCHEDULER_LEASE,
              ownerId: this.instanceId,
              leaseUntil,
            },
          ],
          skipDuplicates: true,
        });

        const leaseUpdate = await tx.clusterLease.updateMany({
          where: {
            name: ConsistencyService.SCHEDULER_LEASE,
            OR: [
              { ownerId: this.instanceId },
              { leaseUntil: { lt: now } },
            ],
          },
          data: {
            ownerId: this.instanceId,
            leaseUntil,
          },
        });

        const ownsLease = leaseUpdate.count === 1;

        await tx.clusterNode.update({
          where: { id: this.instanceId },
          data: { isLeader: ownsLease },
        });

        if (ownsLease) {
          await tx.clusterNode.updateMany({
            where: { id: { not: this.instanceId }, isLeader: true },
            data: { isLeader: false },
          });
        }

        return ownsLease;
      });

      if (acquired && !this.isLeader) {
        this.logger.log(`Node ${this.instanceId} became cluster LEADER`);
      } else if (!acquired && this.isLeader) {
        this.logger.warn(`Node ${this.instanceId} lost cluster leadership`);
      }

      this.isLeader = acquired;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2028'
      ) {
        this.logger.debug('Leader lease renewal conflicted with another node');
      } else {
        this.logger.error('Leader lease renewal failed', error);
      }
      await this.prisma.clusterNode
        .updateMany({
          where: { id: this.instanceId, isLeader: true },
          data: { isLeader: false },
        })
        .catch(() => {});
      this.isLeader = false;
    }
  }

  private async releaseLeadership(): Promise<void> {
    if (!this.isLeader) {
      return;
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.clusterLease.updateMany({
        where: {
          name: ConsistencyService.SCHEDULER_LEASE,
          ownerId: this.instanceId,
        },
        data: { leaseUntil: now },
      }),
      this.prisma.clusterNode.updateMany({
        where: { id: this.instanceId },
        data: { isLeader: false },
      }),
    ]);

    this.isLeader = false;
  }

  /** Check if this node is the current leader */
  getIsLeader(): boolean {
    return this.healthSnapshot.isLeader;
  }

  private createPartitionedSnapshot(
    checkedAt = new Date(),
  ): ClusterHealthSnapshot {
    return {
      health: ClusterHealth.PARTITIONED,
      checkedAt,
      databaseReachable: false,
      writeSafe: false,
      selfRegistered: false,
      aliveNodeCount: 0,
      requiredNodeCount: Math.max(this.minNodes, 1),
      nodeQuorumMet: false,
      schedulerLeaseOwnerId: null,
      schedulerLeaseExpiresAt: null,
      schedulerReady: false,
      isLeader: false,
    };
  }
}
