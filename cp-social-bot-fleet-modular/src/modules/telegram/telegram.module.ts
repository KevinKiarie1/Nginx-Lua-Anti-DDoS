// ============================================================
// TELEGRAM MODULE
// ============================================================
// Self-contained NestJS module for Telegram platform operations.
// Depends only on CoreModule — never imports other platform modules.
//
// Contains:
//   - TelegramHandler: PlatformHandler implementation (Telegraf.js)
//   - TelegramService: Account management business logic
//   - TelegramController: REST API for Telegram-specific endpoints
//
// MODULAR BOUNDARY: This module is completely independent.
// Communication with other modules happens only through the
// shared task queue in CoreModule.
// ============================================================

import { Module } from '@nestjs/common';
import { TelegramHandler } from './telegram.handler';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';

@Module({
  controllers: [TelegramController],
  providers: [TelegramHandler, TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
