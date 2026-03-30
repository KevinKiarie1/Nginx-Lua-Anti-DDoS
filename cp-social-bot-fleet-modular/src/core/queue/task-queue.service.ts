// ============================================================
// TASK QUEUE SERVICE — DB-Backed CP-Consistent Queue
// ============================================================
// Instead of Redis/BullMQ (which are AP systems), we use
// CockroachDB itself as the task queue. Every state transition
// is a SERIALIZABLE transaction replicated via Raft consensus.
//
// Task Lifecycle:
//   PENDING → CLAIMED → RUNNING → COMPLETED
//                                → FAILED → PENDING (retry)
//                                → DEAD_LETTER (max retries)
//
// CP Guarantees:
// - Task claiming uses SERIALIZABLE isolation — no two workers
//   can claim the same task (phantom reads prevented).
// - Idempotency keys prevent duplicate task creation.
// - Claims use renewable leases so long-running workers keep
//   ownership without being re-queued mid-execution.
// - Expired task leases (worker crash / timeout) are released
//   back to PENDING by the scheduler service.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Platform, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ConsistencyService } from '../consistency/consistency.service';
import { CreateTaskDto } from '../../common/dto/create-task.dto';
import { validateTaskRequest } from '../../common/task-capabilities';

export class TaskLeaseOwnershipError extends Error {
  constructor(taskId: string) {
    super(`Lost lease ownership for task ${taskId}`);
    this.name = 'TaskLeaseOwnershipError';
  }
}

@Injectable()
export class TaskQueueService {
  private readonly logger = new Logger(TaskQueueService.name);
  private readonly instanceId: string;
  private readonly workerLeaseDurationMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consistency: ConsistencyService,
    private readonly config: ConfigService,
  ) {
    this.instanceId = this.config.get<string>('app.instanceId')!;
    this.workerLeaseDurationMs = this.config.get<number>(
      'app.workerLeaseDurationMs',
    )!;
  }

  private getLeaseExpiration(fromDate = new Date()): Date {
    return new Date(fromDate.getTime() + this.workerLeaseDurationMs);
  }

  /**
   * Create a new task in the queue.
  * Uses idempotency key to prevent duplicates during enqueueing.
   */
  async createTask(dto: CreateTaskDto) {
    // CP Gate: require healthy cluster before writes
    await this.consistency.requireHealthy();

    validateTaskRequest(dto);

    const createData = {
      type: dto.type,
      platform: dto.platform,
      payload: dto.payload as Prisma.InputJsonValue,
      idempotencyKey: dto.idempotencyKey,
      accountId: dto.accountId,
      priority: dto.priority ?? 100,
      maxRetries: dto.maxRetries ?? 3,
    };

    // Check idempotency — if a task with this key exists, return it
    if (dto.idempotencyKey) {
      const existing = await this.prisma.task.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        this.logger.debug(
          `Duplicate task rejected (idempotency key: ${dto.idempotencyKey})`,
        );
        return existing;
      }
    }

    try {
      return await this.prisma.task.create({ data: createData });
    } catch (error) {
      if (
        dto.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.task.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  /**
   * Atomically claim the next available task for the given platforms.
   *
   * CP Decision: Uses SERIALIZABLE isolation via interactive Prisma
   * transaction. CockroachDB will detect phantom reads and abort one
   * of two concurrent claimants. The loser gets a serialization error
   * and retries on the next poll cycle.
   */
  async claimNextTask(platforms: Platform[]): Promise<string | null> {
    await this.consistency.requireHealthy();

    try {
      const now = new Date();
      return await this.prisma.$transaction(
        async (tx) => {
          // Find the highest-priority pending task for our platforms
          // that is either not waiting for a retry or whose retry delay has elapsed
          const task = await tx.task.findFirst({
            where: {
              status: 'PENDING',
              platform: { in: platforms },
              OR: [
                { nextRetryAt: null },
                { nextRetryAt: { lte: now } },
              ],
            },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          });

          if (!task) return null;

          // Atomically claim it — the WHERE clause on status prevents
          // double-claiming even without explicit locking
          const claimed = await tx.task.updateMany({
            where: { id: task.id, status: 'PENDING' },
            data: {
              status: 'CLAIMED',
              claimedBy: this.instanceId,
              claimedAt: now,
              leaseExpiresAt: this.getLeaseExpiration(now),
              workerHeartbeatAt: now,
            },
          });

          if (claimed.count !== 1) {
            return null;
          }

          this.logger.debug(
            `Claimed task ${task.id} (${task.type} on ${task.platform})`,
          );
          return task.id;
        },
        // CockroachDB defaults to SERIALIZABLE isolation —
        // no explicit isolationLevel needed (and Prisma's CockroachDB
        // adapter doesn't expose TransactionIsolationLevel).
      );
    } catch (error) {
      // Serialization conflicts are expected under contention
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        this.logger.debug(
          'Serialization conflict during task claim — will retry next cycle',
        );
        return null;
      }
      throw error;
    }
  }

  /** Mark a claimed task as running */
  async markTaskRunning(taskId: string): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.task.updateMany({
      where: {
        id: taskId,
        claimedBy: this.instanceId,
        status: TaskStatus.CLAIMED,
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: 'RUNNING',
        startedAt: now,
        workerHeartbeatAt: now,
        leaseExpiresAt: this.getLeaseExpiration(now),
      },
    });

    if (updated.count !== 1) {
      throw new TaskLeaseOwnershipError(taskId);
    }
  }

  /** Renew the lease for a currently running task owned by this instance */
  async renewTaskLease(taskId: string): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.task.updateMany({
      where: {
        id: taskId,
        claimedBy: this.instanceId,
        status: { in: ['CLAIMED', 'RUNNING'] },
      },
      data: {
        workerHeartbeatAt: now,
        leaseExpiresAt: this.getLeaseExpiration(now),
      },
    });

    return result.count === 1;
  }

  /** Mark a task as completed with optional result data */
  async markTaskCompleted(
    taskId: string,
    result?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        claimedBy: this.instanceId,
        status: { in: [TaskStatus.CLAIMED, TaskStatus.RUNNING] },
        leaseExpiresAt: { gt: now },
      },
    });

    if (!task) {
      throw new TaskLeaseOwnershipError(taskId);
    }

    await this.prisma.$transaction([
      this.prisma.task.updateMany({
        where: {
          id: taskId,
          claimedBy: this.instanceId,
          status: { in: [TaskStatus.CLAIMED, TaskStatus.RUNNING] },
          leaseExpiresAt: { gt: now },
        },
        data: {
          status: 'COMPLETED',
          result: (result as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          completedAt: now,
          leaseExpiresAt: null,
          workerHeartbeatAt: null,
        },
      }),
      // Write audit trail
      ...(task.accountId
        ? [
            this.prisma.postHistory.create({
              data: {
                platform: task.platform,
                taskType: task.type,
                accountId: task.accountId,
                taskId: task.id,
                resultData: (result as Prisma.InputJsonValue) ?? Prisma.JsonNull,
              },
            }),
          ]
        : []),
    ]);

    this.logger.log(`Task ${taskId} completed`);
  }

  /**
   * Mark a task as failed, with automatic retry or dead-letter.
   *
   * CP Decision: If retries remain, the task is reset to PENDING
   * (not FAILED) so it re-enters the queue. If max retries are
   * exhausted, it moves to DEAD_LETTER for manual inspection.
   */
  async markTaskFailed(
    taskId: string,
    errorMessage: string,
    options?: { retryable?: boolean },
  ): Promise<void> {
    const now = new Date();
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        claimedBy: this.instanceId,
        status: { in: [TaskStatus.CLAIMED, TaskStatus.RUNNING] },
        leaseExpiresAt: { gt: now },
      },
    });
    if (!task) {
      throw new TaskLeaseOwnershipError(taskId);
    }

    const nextRetryCount = task.retryCount + 1;
    const retryable = options?.retryable ?? true;
    const isFinalFailure = !retryable || nextRetryCount >= task.maxRetries;

    if (isFinalFailure) {
      const updated = await this.prisma.task.updateMany({
        where: {
          id: taskId,
          claimedBy: this.instanceId,
          status: { in: [TaskStatus.CLAIMED, TaskStatus.RUNNING] },
          leaseExpiresAt: { gt: now },
        },
        data: {
          status: 'DEAD_LETTER',
          errorMessage,
          retryCount: nextRetryCount,
          completedAt: new Date(),
          leaseExpiresAt: null,
          workerHeartbeatAt: null,
          nextRetryAt: null,
        },
      });
      if (updated.count !== 1) {
        throw new TaskLeaseOwnershipError(taskId);
      }
      this.logger.warn(
        `Task ${taskId} moved to DEAD_LETTER after ${nextRetryCount} attempts`,
      );
    } else {
      // Exponential backoff: 5s, 20s, 80s, 320s …
      const backoffMs = 5000 * Math.pow(4, nextRetryCount - 1);
      const nextRetryAt = new Date(now.getTime() + backoffMs);

      // Reset to PENDING for retry
      const updated = await this.prisma.task.updateMany({
        where: {
          id: taskId,
          claimedBy: this.instanceId,
          status: { in: [TaskStatus.CLAIMED, TaskStatus.RUNNING] },
          leaseExpiresAt: { gt: now },
        },
        data: {
          status: 'PENDING',
          errorMessage,
          retryCount: nextRetryCount,
          claimedBy: null,
          claimedAt: null,
          startedAt: null,
          leaseExpiresAt: null,
          workerHeartbeatAt: null,
          nextRetryAt,
        },
      });
      if (updated.count !== 1) {
        throw new TaskLeaseOwnershipError(taskId);
      }
      this.logger.warn(
        `Task ${taskId} failed (attempt ${nextRetryCount}/${task.maxRetries}), re-queued`,
      );
    }
  }

  /** Get a task by ID */
  async getTask(taskId: string) {
    return this.prisma.task.findUnique({ where: { id: taskId } });
  }

  /**
   * Release tasks that were claimed but never completed (worker crash).
   * Called periodically by the scheduler service.
   */
  async releaseExpiredTaskLeases(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.task.updateMany({
      where: {
        status: { in: ['CLAIMED', 'RUNNING'] },
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: 'PENDING',
        claimedBy: null,
        claimedAt: null,
        startedAt: null,
        leaseExpiresAt: null,
        workerHeartbeatAt: null,
      },
    });

    if (result.count > 0) {
      this.logger.warn(
        `Released ${result.count} expired task leases back to PENDING`,
      );
    }
    return result.count;
  }

  /** Get queue statistics for monitoring */
  async getQueueStats() {
    const [pending, claimed, running, completed, failed, deadLetter] =
      await Promise.all([
        this.prisma.task.count({ where: { status: 'PENDING' } }),
        this.prisma.task.count({ where: { status: 'CLAIMED' } }),
        this.prisma.task.count({ where: { status: 'RUNNING' } }),
        this.prisma.task.count({ where: { status: 'COMPLETED' } }),
        this.prisma.task.count({ where: { status: 'FAILED' } }),
        this.prisma.task.count({ where: { status: 'DEAD_LETTER' } }),
      ]);

    return { pending, claimed, running, completed, failed, deadLetter };
  }
}
