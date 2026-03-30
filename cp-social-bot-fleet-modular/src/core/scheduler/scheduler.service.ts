// ============================================================
// SCHEDULER SERVICE — Cron-Like DB-Backed Scheduler
// ============================================================
// Evaluates Schedule records stored in the database and creates
// tasks when schedules are due. Only the LEADER node runs the
// scheduler to prevent duplicate task creation (CP guarantee).
//
// Why not @nestjs/schedule + @Cron() decorators?
// 1. We need schedule definitions stored in the DB, not hardcoded.
// 2. @Cron runs on EVERY instance — that would create duplicate
//    tasks across replicas, violating CP. Our scheduler runs
//    only on the leader (ConsistencyService.getIsLeader()).
// ============================================================

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import { PrismaService } from '../database/prisma.service';
import { TaskQueueService } from '../queue/task-queue.service';
import { ConsistencyService } from '../consistency/consistency.service';
import { RateLimiterService } from '../rate-limiter/rate-limiter.service';
import { AccountHealthService } from '../account-health/account-health.service';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly evaluationIntervalMs = 30_000; // Every 30 seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: TaskQueueService,
    private readonly consistency: ConsistencyService,
    private readonly rateLimiter: RateLimiterService,
    private readonly accountHealth: AccountHealthService,
  ) {}

  onModuleInit() {
    this.startEvaluator();
  }

  onModuleDestroy() {
    this.stopEvaluator();
  }

  private startEvaluator(): void {
    this.timer = setInterval(
      () => this.evaluate(),
      this.evaluationIntervalMs,
    );
    this.logger.log(
      `Schedule evaluator started (every ${this.evaluationIntervalMs}ms)`,
    );
  }

  private stopEvaluator(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Evaluate all active schedules and create tasks for due ones.
   *
   * LEADER-ONLY: Non-leader nodes skip evaluation to prevent
   * duplicate task creation across instances. The idempotency
   * key (schedule:id:timestamp) provides an additional safety net.
   */
  async evaluate(): Promise<void> {
    // CP Gate: Only the leader evaluates schedules
    if (!(await this.consistency.hasLeadership())) {
      return;
    }

    try {
      await this.consistency.requireHealthy();
    } catch {
      this.logger.debug(
        'Skipping schedule evaluation — cluster not healthy',
      );
      return;
    }

    const now = new Date();
    const dueSchedules = await this.prisma.schedule.findMany({
      where: {
        isActive: true,
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
    });

    for (const schedule of dueSchedules) {
      try {
        const nextRun = this.calculateNextRun(schedule.cronExpr, now);

        // Create a task from the schedule with an idempotency key
        // that includes the schedule ID and current time bucket
        await this.queue.createTask({
          type: schedule.taskType,
          platform: schedule.platform,
          payload: (schedule.payload as Record<string, unknown>) ?? {},
          idempotencyKey: `schedule:${schedule.id}:${now.toISOString().slice(0, 16)}`,
          accountId: schedule.accountId ?? undefined,
        });

        // Update schedule with next run time
        await this.prisma.schedule.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, nextRunAt: nextRun },
        });

        this.logger.log(
          `Schedule "${schedule.name}" triggered, next run: ${nextRun.toISOString()}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to evaluate schedule ${schedule.id}`,
          error,
        );
      }
    }

    // Leader-only periodic maintenance
    await this.queue.releaseExpiredTaskLeases();
    await this.rateLimiter.cleanup();
    await this.accountHealth.cleanup();
  }

  /**
   * Parse a cron expression using cron-parser and return the next
   * occurrence after the given date.
   */
  calculateNextRun(cronExpr: string, fromDate: Date): Date {
    try {
      const interval = CronExpressionParser.parse(cronExpr, {
        currentDate: fromDate,
      });
      return interval.next().toDate();
    } catch (error) {
      this.logger.warn(
        `Invalid cron expression "${cronExpr}", falling back to 1h: ${error}`,
      );
      return new Date(fromDate.getTime() + 3600_000);
    }
  }
}
