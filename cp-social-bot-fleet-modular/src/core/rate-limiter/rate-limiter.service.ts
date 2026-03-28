// ============================================================
// RATE LIMITER SERVICE
// ============================================================
// Enforces per-platform rate limits using the DB as the source
// of truth — not in-memory counters (which would lose CP
// guarantees in a multi-instance deployment).
//
// CP Decision: Rate limit events are stored in CockroachDB so
// ALL instances share the same rate-limit state. This prevents
// Instance A from burning through limits while Instance B is
// unaware — maintaining consistent rate enforcement.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Platform } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly limits: Record<string, number>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.limits = {
      TELEGRAM: this.config.get<number>('app.rateLimitTelegram')!,
      TIKTOK: this.config.get<number>('app.rateLimitTiktok')!,
      INSTAGRAM: this.config.get<number>('app.rateLimitInstagram')!,
      FACEBOOK: this.config.get<number>('app.rateLimitFacebook')!,
    };
  }

  /**
   * Check if an action is allowed under rate limits.
   * Counts events in the last 60 seconds for this platform.
   */
  async checkLimit(
    platform: Platform,
    accountId?: string,
  ): Promise<boolean> {
    const windowStart = new Date(Date.now() - 60_000); // 1-minute window
    const limit = this.limits[platform] ?? 10;

    const count = await this.prisma.rateLimitEvent.count({
      where: {
        platform,
        ...(accountId ? { accountId } : {}),
        createdAt: { gte: windowStart },
      },
    });

    return count < limit;
  }

  /** Record a rate-limit event */
  async recordEvent(
    platform: Platform,
    eventType: string,
    accountId?: string,
  ): Promise<void> {
    await this.prisma.rateLimitEvent.create({
      data: { platform, eventType, accountId },
    });
  }

  /**
   * Check and record in one step. Returns true if allowed.
   * This is the primary method used by the task dispatcher.
   */
  async acquireSlot(
    platform: Platform,
    eventType: string,
    accountId?: string,
  ): Promise<boolean> {
    const allowed = await this.checkLimit(platform, accountId);
    if (allowed) {
      await this.recordEvent(platform, eventType, accountId);
    } else {
      this.logger.warn(
        `Rate limit hit for ${platform}` +
          (accountId ? ` (account: ${accountId})` : ''),
      );
    }
    return allowed;
  }

  /** Clean up old rate limit events (older than 1 hour) */
  async cleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - 3600_000);
    await this.prisma.rateLimitEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
  }
}
