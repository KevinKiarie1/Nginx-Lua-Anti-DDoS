// ============================================================
// TIKTOK MODULE
// ============================================================
// Self-contained module for TikTok automation via Playwright.
// Uses stealth browser contexts with anti-detection measures.
//
// MODULAR BOUNDARY: Depends only on CoreModule.
// Never imports other platform modules.
// ============================================================

import { Module } from '@nestjs/common';
import { TiktokHandler } from './tiktok.handler';
import { TiktokService } from './tiktok.service';
import { TiktokController } from './tiktok.controller';

@Module({
  controllers: [TiktokController],
  providers: [TiktokHandler, TiktokService],
  exports: [TiktokService],
})
export class TiktokModule {}
