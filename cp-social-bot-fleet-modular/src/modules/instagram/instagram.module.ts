// ============================================================
// INSTAGRAM MODULE
// ============================================================
// Self-contained module for Instagram automation via Playwright.
// Uses stealth browser contexts with anti-detection measures.
//
// MODULAR BOUNDARY: Depends only on CoreModule.
// Never imports other platform modules.
// ============================================================

import { Module } from '@nestjs/common';
import { InstagramHandler } from './instagram.handler';
import { InstagramService } from './instagram.service';
import { InstagramController } from './instagram.controller';

@Module({
  controllers: [InstagramController],
  providers: [InstagramHandler, InstagramService],
  exports: [InstagramService],
})
export class InstagramModule {}
