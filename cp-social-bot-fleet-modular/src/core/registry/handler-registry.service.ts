// ============================================================
// PLATFORM HANDLER REGISTRY
// ============================================================
// Central registry where platform modules register their
// PlatformHandler implementations. The task dispatcher uses
// this registry to route tasks to the correct handler.
//
// MODULAR BOUNDARY: Platform modules call register() during
// their onModuleInit() lifecycle hook. The registry doesn't
// know about any specific platform — it only stores references
// to the PlatformHandler interface.
//
// This decouples the task dispatcher from platform-specific
// code, maintaining the modular monolith boundary.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { PlatformHandler } from '../../common/interfaces/platform-handler.interface';

@Injectable()
export class HandlerRegistryService {
  private readonly logger = new Logger(HandlerRegistryService.name);
  private readonly handlers = new Map<Platform, PlatformHandler>();

  /** Register a platform handler (called by platform modules on init) */
  register(handler: PlatformHandler): void {
    this.handlers.set(handler.platform, handler);
    this.logger.log(`Platform handler registered: ${handler.platform}`);
  }

  /** Get handler for a specific platform */
  getHandler(platform: Platform): PlatformHandler | undefined {
    return this.handlers.get(platform);
  }

  /** Get all registered handlers */
  getAllHandlers(): PlatformHandler[] {
    return Array.from(this.handlers.values());
  }

  /** Get all registered platform names */
  getRegisteredPlatforms(): Platform[] {
    return Array.from(this.handlers.keys());
  }

  /** Initialize all registered handlers */
  async initializeAll(): Promise<void> {
    for (const handler of this.handlers.values()) {
      await handler.initialize();
    }
    this.logger.log(
      `All ${this.handlers.size} platform handlers initialized`,
    );
  }

  /** Shutdown all registered handlers */
  async shutdownAll(): Promise<void> {
    for (const handler of this.handlers.values()) {
      await handler.shutdown().catch((err) => {
        this.logger.error(
          `Error shutting down ${handler.platform} handler`,
          err,
        );
      });
    }
  }
}
