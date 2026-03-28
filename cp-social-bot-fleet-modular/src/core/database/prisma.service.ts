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

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(
      'Database connected (CockroachDB — SERIALIZABLE isolation)',
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
