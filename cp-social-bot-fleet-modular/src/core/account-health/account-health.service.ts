import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export enum HealthEventType {
  BAN = 'BAN',
  CAPTCHA = 'CAPTCHA',
  RATE_LIMIT = 'RATE_LIMIT',
  SUSPENSION = 'SUSPENSION',
  RECOVERY = 'RECOVERY',
}

@Injectable()
export class AccountHealthService {
  private readonly logger = new Logger(AccountHealthService.name);

  /** Cooldown window — accounts with recent severe events are paused. */
  private static readonly COOLDOWN_MS = 30 * 60_000; // 30 minutes
  private static readonly CRITICAL_THRESHOLD = 3;

  constructor(private readonly prisma: PrismaService) {}

  async recordEvent(
    accountId: string,
    eventType: HealthEventType,
    severity: number,
    detail?: string,
  ): Promise<void> {
    await this.prisma.accountHealthEvent.create({
      data: { accountId, eventType, severity, detail },
    });
    this.logger.warn(
      `Health event: ${eventType} (severity ${severity}) on account ${accountId}`,
    );

    // Auto-deactivate on critical severity burst
    if (severity >= 4) {
      const recentCritical = await this.countRecentEvents(
        accountId,
        AccountHealthService.COOLDOWN_MS,
        4,
      );
      if (recentCritical >= AccountHealthService.CRITICAL_THRESHOLD) {
        await this.prisma.account.update({
          where: { id: accountId },
          data: { isActive: false },
        });
        this.logger.error(
          `Account ${accountId} auto-deactivated after ${recentCritical} critical events`,
        );
      }
    }
  }

  /** Check if an account is in cooldown and should not be used. */
  async isInCooldown(accountId: string): Promise<boolean> {
    const cutoff = new Date(
      Date.now() - AccountHealthService.COOLDOWN_MS,
    );
    const count = await this.prisma.accountHealthEvent.count({
      where: {
        accountId,
        severity: { gte: 3 },
        createdAt: { gte: cutoff },
      },
    });
    return count > 0;
  }

  async getAccountHealth(accountId: string) {
    const recent = await this.prisma.accountHealthEvent.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const inCooldown = await this.isInCooldown(accountId);
    return { accountId, inCooldown, recentEvents: recent };
  }

  private async countRecentEvents(
    accountId: string,
    windowMs: number,
    minSeverity: number,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - windowMs);
    return this.prisma.accountHealthEvent.count({
      where: {
        accountId,
        severity: { gte: minSeverity },
        createdAt: { gte: cutoff },
      },
    });
  }

  /** Purge health events older than the given retention period. */
  async cleanup(retentionMs = 7 * 24 * 3600_000): Promise<number> {
    const cutoff = new Date(Date.now() - retentionMs);
    const result = await this.prisma.accountHealthEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
