// ============================================================
// PRISMA MODULE
// ============================================================
// Global module — PrismaService is available everywhere without
// explicit imports. Single source of truth for DB access.
// ============================================================

import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
