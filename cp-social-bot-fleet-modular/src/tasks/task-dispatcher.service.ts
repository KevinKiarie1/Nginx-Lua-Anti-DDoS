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
import {
  TaskLeaseOwnershipError,
  TaskQueueService,
} from '../core/queue/task-queue.service';
import { ConsistencyService } from '../core/consistency/consistency.service';
import { HandlerRegistryService } from '../core/registry/handler-registry.service';
import { RateLimiterService } from '../core/rate-limiter/rate-limiter.service';
import { AccountHealthService } from '../core/account-health/account-health.service';
import { HealthEventType } from '../core/account-health/account-health.service';

@Injectable()
export class TaskDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskDispatcherService.name);
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private activeTasks = 0;
  private isShuttingDown = false;
  private currentPollMs: number;

  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private readonly pollBackoffMultiplier: number;
  private readonly maxConcurrentTasks: number;
  private readonly leaseRenewIntervalMs: number;
  private readonly taskTimeoutMs: number;
  private readonly platforms: Platform[];

  constructor(
    private readonly queue: TaskQueueService,
    private readonly consistency: ConsistencyService,
    private readonly registry: HandlerRegistryService,
    private readonly rateLimiter: RateLimiterService,
    private readonly accountHealth: AccountHealthService,
    private readonly config: ConfigService,
  ) {
    this.pollIntervalMs = this.config.get<number>(
      'app.workerPollIntervalMs',
    )!;
    this.maxPollIntervalMs = this.config.get<number>(
      'app.workerMaxPollIntervalMs',
    )!;
    this.pollBackoffMultiplier = this.config.get<number>(
      'app.workerPollBackoffMultiplier',
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
    this.currentPollMs = this.pollIntervalMs;

    const platformStr = this.config.get<string>('app.workerPlatforms')!;
    this.platforms = platformStr
      .split(',')
      .map((p) => p.trim().toUpperCase() as Platform)
      .filter((p) => Object.values(Platform).includes(p));
  }

  async onModuleInit() {
    // Allow platform handlers to register (they register in their onModuleInit)
    // then initialize all of them before starting the poll loop.
    await this.initializeAndStart();
  }

  onModuleDestroy() {
    this.stopPolling();
  }

  private async initializeAndStart(): Promise<void> {
    // Retry initialization a few times in case DB or handlers aren't ready
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.registry.initializeAll();
        this.logger.log(
          `Task dispatcher started — polling every ${this.pollIntervalMs}ms ` +
            `(backoff up to ${this.maxPollIntervalMs}ms) ` +
            `for platforms: ${this.platforms.join(', ')}`,
        );

        this.schedulePoll();
        return;
      } catch (err) {
        this.logger.warn(
          `Handler initialization attempt ${attempt}/${maxAttempts} failed`,
          err,
        );
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 3000 * attempt));
        } else {
          this.logger.error(
            'Failed to initialize platform handlers after max attempts',
            err,
          );
        }
      }
    }
  }

  /**
   * Schedule the next poll using adaptive backoff.
   * When the queue is empty, the delay grows by pollBackoffMultiplier
   * up to maxPollIntervalMs. When a task is found, it snaps back
   * to the base pollIntervalMs — saving CPU/DB on idle A1 VMs.
   */
  private schedulePoll(): void {
    if (this.isShuttingDown) return;
    this.pollTimeout = setTimeout(() => {
      this.poll()
        .then((foundTask) => {
          if (foundTask) {
            // Snap back to base interval when work is available
            this.currentPollMs = this.pollIntervalMs;
          } else {
            // Exponential backoff when idle
            this.currentPollMs = Math.min(
              this.currentPollMs * this.pollBackoffMultiplier,
              this.maxPollIntervalMs,
            );
          }
          this.schedulePoll();
        })
        .catch((err) => {
          this.logger.error('Poll cycle error', err);
          this.schedulePoll();
        });
    }, this.currentPollMs);
  }

  private stopPolling(): void {
    this.isShuttingDown = true;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  /**
   * Single poll cycle. Returns true if a task was claimed.
   */
  private async poll(): Promise<boolean> {
    // CP Gate: Skip if cluster is not healthy
    try {
      await this.consistency.requireHealthy();
    } catch {
      this.logger.debug('Skipping poll — cluster not healthy');
      return false;
    }

    // Concurrency limit
    if (this.activeTasks >= this.maxConcurrentTasks) return false;

    // Claim next task from the queue
    const taskId = await this.queue.claimNextTask(this.platforms);
    if (!taskId) return false;

    // Execute in background (non-blocking to the poll loop)
    this.executeTask(taskId).catch((err) =>
      this.logger.error(`Unhandled task error: ${taskId}`, err),
    );
    return true;
  }

  private async executeTask(taskId: string): Promise<void> {
    this.activeTasks++;
    let leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
    let leaseOwnershipLost = false;

    try {
      await this.queue.markTaskRunning(taskId);

      leaseRenewTimer = setInterval(() => {
        this.queue
          .renewTaskLease(taskId)
          .then((renewed) => {
            if (!renewed) {
              leaseOwnershipLost = true;
              this.logger.warn(
                `Lease renewal skipped for task ${taskId} — ownership lost`,
              );
              if (leaseRenewTimer) {
                clearInterval(leaseRenewTimer);
                leaseRenewTimer = null;
              }
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

      // Account health check — skip tasks for accounts in cooldown
      if (task.accountId) {
        const inCooldown = await this.accountHealth.isInCooldown(
          task.accountId,
        );
        if (inCooldown) {
          if (leaseOwnershipLost) return;
          await this.queue.markTaskFailed(
            taskId,
            'Account in cooldown — will retry later',
          );
          return;
        }
      }

      // Rate limit check — if rate-limited, re-queue (not a failure)
      const allowed = await this.rateLimiter.acquireSlot(
        task.platform,
        task.type,
        task.accountId ?? undefined,
      );
      if (!allowed) {
        if (leaseOwnershipLost) {
          this.logger.warn(
            `Discarding rate-limit retry for task ${taskId} after lease loss`,
          );
          return;
        }
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

      if (leaseOwnershipLost) {
        this.logger.warn(
          `Discarding result for task ${taskId} because lease ownership was lost`,
        );
        return;
      }

      if (result.success) {
        await this.queue.markTaskCompleted(taskId, result.data);
      } else {
        // Detect ban/captcha signals from handler error messages
        if (task.accountId && result.error) {
          const lower = result.error.toLowerCase();
          if (lower.includes('ban') || lower.includes('suspended')) {
            await this.accountHealth.recordEvent(
              task.accountId,
              HealthEventType.BAN,
              4,
              result.error,
            );
          } else if (lower.includes('captcha') || lower.includes('challenge')) {
            await this.accountHealth.recordEvent(
              task.accountId,
              HealthEventType.CAPTCHA,
              3,
              result.error,
            );
          }
        }
        await this.queue.markTaskFailed(
          taskId,
          result.error ?? 'Unknown error',
        );
      }
    } catch (error) {
      if (error instanceof TaskLeaseOwnershipError) {
        this.logger.warn(error.message);
        return;
      }

      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Task ${taskId} failed: ${msg}`);
      const retryable = msg !== 'Task timed out';
      await this.queue
        .markTaskFailed(taskId, msg, { retryable })
        .catch((markError) => {
          if (markError instanceof TaskLeaseOwnershipError) {
            this.logger.warn(markError.message);
          }
        });
    } finally {
      if (leaseRenewTimer) {
        clearInterval(leaseRenewTimer);
      }
      this.activeTasks--;
    }
  }
}
