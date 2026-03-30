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
// 4. Platform Modules — conditionally loaded based on
//                      WORKER_PLATFORMS env var
//
// MODULAR MONOLITH RULE:
// Platform modules NEVER import each other. They only depend
// on CoreModule and communicate through the shared task queue.
// Adding a new platform is as simple as creating a new module
// and registering it here.
//
// ORACLE A1 OPTIMIZATION:
// On resource-constrained VMs, set WORKER_PLATFORMS=TELEGRAM
// to load only the modules you need — avoids starting
// Playwright/Chromium when only the Telegram bot is required.
// ============================================================

import {
  Module,
  DynamicModule,
  MiddlewareConsumer,
  NestModule,
  Logger,
  Type,
} from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { CoreModule } from './core/core.module';
import { TasksModule } from './tasks/tasks.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TiktokModule } from './modules/tiktok/tiktok.module';
import { InstagramModule } from './modules/instagram/instagram.module';
import { FacebookModule } from './modules/facebook/facebook.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

/** Map of platform name → NestJS module */
const PLATFORM_MODULE_MAP: Record<string, Type> = {
  TELEGRAM: TelegramModule,
  TIKTOK: TiktokModule,
  INSTAGRAM: InstagramModule,
  FACEBOOK: FacebookModule,
};

@Module({})
export class AppModule implements NestModule {
  private static readonly logger = new Logger(AppModule.name);

  /**
   * Build the root module dynamically, loading only the platform
   * modules listed in WORKER_PLATFORMS.
   */
  static register(): DynamicModule {
    const platformStr =
      process.env.WORKER_PLATFORMS ?? 'TELEGRAM,TIKTOK,INSTAGRAM,FACEBOOK';
    const requested = platformStr
      .split(',')
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean);

    const platformModules: Type[] = [];
    for (const key of requested) {
      const mod = PLATFORM_MODULE_MAP[key];
      if (mod) {
        platformModules.push(mod);
      } else {
        AppModule.logger.warn(`Unknown platform "${key}" — skipping`);
      }
    }

    AppModule.logger.log(
      `Loading platform modules: ${requested.filter((k) => PLATFORM_MODULE_MAP[k]).join(', ') || 'NONE'}`,
    );

    return {
      module: AppModule,
      imports: [
        // ── Global configuration (loaded first) ─────────────
        ConfigModule,

        // ── Shared infrastructure ───────────────────────────
        CoreModule,

        // ── Task dispatcher + API ───────────────────────────
        TasksModule,

        // ── Platform modules (only those requested) ─────────
        ...platformModules,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
