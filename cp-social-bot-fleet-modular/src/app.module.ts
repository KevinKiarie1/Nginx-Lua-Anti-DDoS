// ============================================================
// APP MODULE — Root of the Modular Monolith
// ============================================================
// This is the composition root. It imports:
//
// 1. ConfigModule    — environment validation & typed config
// 2. CoreModule      — shared infrastructure (DB, queue,
//                      scheduler, consistency, crypto, proxy,
//                      browser, human behavior, rate limiter,
//                      handler registry)
// 3. TasksModule     — task dispatcher + REST API controllers
// 4. Platform Modules — each is a self-contained boundary
//
// MODULAR MONOLITH RULE:
// Platform modules NEVER import each other. They only depend
// on CoreModule and communicate through the shared task queue.
// Adding a new platform is as simple as creating a new module
// and registering it here.
// ============================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { CoreModule } from './core/core.module';
import { TasksModule } from './tasks/tasks.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TiktokModule } from './modules/tiktok/tiktok.module';
import { InstagramModule } from './modules/instagram/instagram.module';
import { FacebookModule } from './modules/facebook/facebook.module';

@Module({
  imports: [
    // ── Global configuration (loaded first) ─────────────
    ConfigModule,

    // ── Shared infrastructure ───────────────────────────
    CoreModule,

    // ── Task dispatcher + API ───────────────────────────
    TasksModule,

    // ── Platform modules (independent boundaries) ───────
    TelegramModule,
    TiktokModule,
    InstagramModule,
    FacebookModule,
  ],
})
export class AppModule {}
