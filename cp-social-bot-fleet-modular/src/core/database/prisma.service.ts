// ============================================================
// PRISMA SERVICE
// ============================================================
// Wraps PrismaClient as a NestJS injectable service with
// proper lifecycle management (connect on init, disconnect
// on app shutdown).
//
// CP Note: CockroachDB defaults to SERIALIZABLE isolation.
// We rely on this for task queue atomicity and all critical
// state transitions. Every write goes through Raft consensus.
// ============================================================

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const isProduction = process.env.NODE_ENV === 'production';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: isProduction
        ? [
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: 'info' },
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ],
      datasourceUrl: process.env.DATABASE_URL,
    });
  }

  async onModuleInit() {
    await this.connectWithRetry();
    this.logger.log(
      'Database connected (CockroachDB — SERIALIZABLE isolation)',
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  /**
   * Retry connection with exponential backoff.
   * In production, the database may not be ready immediately
   * after container startup (especially with CockroachDB init).
   */
  private async connectWithRetry(
    maxAttempts = 5,
    baseDelayMs = 2000,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          this.logger.error(
            `Database connection failed after ${maxAttempts} attempts`,
          );
          throw error;
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Database connection attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
