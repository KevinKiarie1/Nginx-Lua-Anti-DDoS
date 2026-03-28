// ============================================================
// TASK DISPATCHER SERVICE
// ============================================================
// The task dispatcher is the bridge between the task queue and
// platform handlers. It:
//
// 1. Polls the DB queue for pending tasks on a configurable interval
// 2. Claims tasks atomically (SERIALIZABLE transaction)
// 3. Routes them to the correct platform handler via the registry
// 4. Reports results back to the queue
//
// It runs as part of the monolith — not a separate process.
// The dispatcher respects CP guarantees by checking cluster
// health before every poll cycle.
// ============================================================

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Platform } from '@prisma/client';
import { TaskQueueService } from '../core/queue/task-queue.service';
import { ConsistencyService } from '../core/consistency/consistency.service';
import { HandlerRegistryService } from '../core/registry/handler-registry.service';
import { RateLimiterService } from '../core/rate-limiter/rate-limiter.service';

@Injectable()
export class TaskDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskDispatcherService.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activeTasks = 0;
  private isShuttingDown = false;

  private readonly pollIntervalMs: number;
  private readonly maxConcurrentTasks: number;
  private readonly leaseRenewIntervalMs: number;
  private readonly taskTimeoutMs: number;
  private readonly platforms: Platform[];

  constructor(
    private readonly queue: TaskQueueService,
    private readonly consistency: ConsistencyService,
    private readonly registry: HandlerRegistryService,
    private readonly rateLimiter: RateLimiterService,
    private readonly config: ConfigService,
  ) {
    this.pollIntervalMs = this.config.get<number>(
      'app.workerPollIntervalMs',
    )!;
    this.maxConcurrentTasks = this.config.get<number>(
      'app.workerMaxConcurrentTasks',
    )!;
    this.leaseRenewIntervalMs = this.config.get<number>(
      'app.workerLeaseRenewIntervalMs',
    )!;
    this.taskTimeoutMs = this.config.get<number>(
      'app.workerTaskTimeoutMs',
    )!;

    const platformStr = this.config.get<string>('app.workerPlatforms')!;
    this.platforms = platformStr
      .split(',')
      .map((p) => p.trim().toUpperCase() as Platform)
      .filter((p) => Object.values(Platform).includes(p));
  }

  async onModuleInit() {
    // Wait for platform handlers to register (they register in their onModuleInit)
    setTimeout(() => this.startPolling(), 5000);
  }

  onModuleDestroy() {
    this.stopPolling();
  }

  private startPolling(): void {
    this.registry
      .initializeAll()
      .then(() => {
        this.logger.log(
          `Task dispatcher started — polling every ${this.pollIntervalMs}ms ` +
            `for platforms: ${this.platforms.join(', ')}`,
        );

        this.pollTimer = setInterval(() => {
          if (!this.isShuttingDown) {
            this.poll().catch((err) =>
              this.logger.error('Poll cycle error', err),
            );
          }
        }, this.pollIntervalMs);
      })
      .catch((err) => {
        this.logger.error('Failed to initialize platform handlers', err);
      });
  }

  private stopPolling(): void {
    this.isShuttingDown = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    // CP Gate: Skip if cluster is not healthy
    try {
      this.consistency.requireHealthy();
    } catch {
      this.logger.debug('Skipping poll — cluster not healthy');
      return;
    }

    // Concurrency limit
    if (this.activeTasks >= this.maxConcurrentTasks) return;

    // Claim next task from the queue
    const taskId = await this.queue.claimNextTask(this.platforms);
    if (!taskId) return;

    // Execute in background (non-blocking to the poll loop)
    this.executeTask(taskId).catch((err) =>
      this.logger.error(`Unhandled task error: ${taskId}`, err),
    );
  }

  private async executeTask(taskId: string): Promise<void> {
    this.activeTasks++;
    let leaseRenewTimer: ReturnType<typeof setInterval> | null = null;

    try {
      await this.queue.markTaskRunning(taskId);

      leaseRenewTimer = setInterval(() => {
        this.queue
          .renewTaskLease(taskId)
          .then((renewed) => {
            if (!renewed) {
              this.logger.warn(
                `Lease renewal skipped for task ${taskId} — ownership lost`,
              );
            }
          })
          .catch((error) => {
            this.logger.error(`Failed to renew task lease: ${taskId}`, error);
          });
      }, this.leaseRenewIntervalMs);

      const task = await this.queue.getTask(taskId);
      if (!task) {
        await this.queue.markTaskFailed(
          taskId,
          'Task not found after claiming',
        );
        return;
      }

      // Rate limit check — if rate-limited, re-queue (not a failure)
      const allowed = await this.rateLimiter.acquireSlot(
        task.platform,
        task.type,
        task.accountId ?? undefined,
      );
      if (!allowed) {
        await this.queue.markTaskFailed(
          taskId,
          'Rate limited — will retry',
        );
        return;
      }

      // Get the platform handler from the registry
      const handler = this.registry.getHandler(task.platform);
      if (!handler) {
        await this.queue.markTaskFailed(
          taskId,
          `No handler for platform: ${task.platform}`,
        );
        return;
      }

      this.logger.log(
        `Executing task ${task.id} (${task.type} on ${task.platform})`,
      );

      // Execute with a hard upper bound, but keep renewing the task lease
      // while the handler is still considered active.
      const result = await Promise.race([
        handler.executeTask(task),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Task timed out')),
            this.taskTimeoutMs,
          ),
        ),
      ]);

      if (result.success) {
        await this.queue.markTaskCompleted(taskId, result.data);
      } else {
        await this.queue.markTaskFailed(
          taskId,
          result.error ?? 'Unknown error',
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Task ${taskId} failed: ${msg}`);
      const retryable = msg !== 'Task timed out';
      await this.queue
        .markTaskFailed(taskId, msg, { retryable })
        .catch(() => {});
    } finally {
      if (leaseRenewTimer) {
        clearInterval(leaseRenewTimer);
      }
      this.activeTasks--;
    }
  }
}
