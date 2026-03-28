// ============================================================
// FACEBOOK MODULE
// ============================================================
// Self-contained module for Facebook automation via Playwright.
// Uses stealth browser contexts with anti-detection measures.
//
// MODULAR BOUNDARY: Depends only on CoreModule.
// Never imports other platform modules.
// ============================================================

import { Module } from '@nestjs/common';
import { FacebookHandler } from './facebook.handler';
import { FacebookService } from './facebook.service';
import { FacebookController } from './facebook.controller';

@Module({
  controllers: [FacebookController],
  providers: [FacebookHandler, FacebookService],
  exports: [FacebookService],
})
export class FacebookModule {}
