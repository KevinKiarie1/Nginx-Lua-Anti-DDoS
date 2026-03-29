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
import { PrismaService } from '../database/prisma.service';
import { TaskQueueService } from '../queue/task-queue.service';
import { ConsistencyService } from '../consistency/consistency.service';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly evaluationIntervalMs = 30_000; // Every 30 seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: TaskQueueService,
    private readonly consistency: ConsistencyService,
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

    // Also release stale tasks periodically (leader responsibility)
    await this.queue.releaseExpiredTaskLeases();
  }

  /**
   * Simple cron-expression parser for common patterns.
   * Format: minute hour day-of-month month day-of-week
   *
   * Supports:
   *   "* /N" intervals (e.g., "0 * /6 * * *" = every 6 hours)
   *   Fixed time (e.g., "30 14 * * *" = 2:30 PM daily)
   *
   * For production, consider using a library like 'cron-parser'.
   */
  calculateNextRun(cronExpr: string, fromDate: Date): Date {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length < 5) {
      // Fallback: run again in 1 hour
      return new Date(fromDate.getTime() + 3600_000);
    }

    const [minutePart, hourPart] = parts;
    const next = new Date(fromDate);

    if (hourPart.startsWith('*/')) {
      const interval = parseInt(hourPart.slice(2), 10);
      next.setHours(next.getHours() + interval);
      next.setMinutes(parseInt(minutePart, 10) || 0);
      next.setSeconds(0);
      next.setMilliseconds(0);
    } else if (minutePart.startsWith('*/')) {
      const interval = parseInt(minutePart.slice(2), 10);
      next.setMinutes(next.getMinutes() + interval);
      next.setSeconds(0);
      next.setMilliseconds(0);
    } else {
      // Fixed time — schedule for next occurrence
      next.setDate(next.getDate() + 1);
      next.setHours(parseInt(hourPart, 10) || 0);
      next.setMinutes(parseInt(minutePart, 10) || 0);
      next.setSeconds(0);
      next.setMilliseconds(0);
    }

    return next;
  }
}
