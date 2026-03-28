// ============================================================
// CORE MODULE — Shared Infrastructure Layer
// ============================================================
// This module provides ALL shared services to the rest of the
// modular monolith. Platform modules import CoreModule to get
// access to:
//
//   - Database (Prisma) — CockroachDB with SERIALIZABLE isolation
//   - Task Queue — DB-backed, CP-consistent task lifecycle
//   - Scheduler — Leader-only cron evaluation
//   - Consistency — Cluster health, leader election, CP gate
//   - Crypto — AES-256-GCM credential encryption
//   - Proxy — Sticky proxy rotation per account
//   - Browser — Stealth Playwright with anti-detection
//   - Human — Behavioral randomization (mouse, typing, delays)
//   - Rate Limiter — DB-backed per-platform throttling
//   - Handler Registry — Platform handler registration
//
// MODULAR BOUNDARY: CoreModule is the ONLY shared dependency.
// Platform modules never import each other — they only import
// CoreModule and communicate through the shared task queue.
// ============================================================

import { Module, Global } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { ConsistencyModule } from './consistency/consistency.module';
import { QueueModule } from './queue/queue.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { CryptoService } from './crypto/crypto.service';
import { ProxyService } from './proxy/proxy.service';
import { BrowserService } from './stealth/browser.service';
import { HumanService } from './stealth/human.service';
import { RateLimiterService } from './rate-limiter/rate-limiter.service';
import { HandlerRegistryService } from './registry/handler-registry.service';

@Global()
@Module({
  imports: [
    PrismaModule,
    ConsistencyModule,
    QueueModule,
    SchedulerModule,
  ],
  providers: [
    CryptoService,
    ProxyService,
    BrowserService,
    HumanService,
    RateLimiterService,
    HandlerRegistryService,
  ],
  exports: [
    PrismaModule,
    ConsistencyModule,
    QueueModule,
    SchedulerModule,
    CryptoService,
    ProxyService,
    BrowserService,
    HumanService,
    RateLimiterService,
    HandlerRegistryService,
  ],
})
export class CoreModule {}
