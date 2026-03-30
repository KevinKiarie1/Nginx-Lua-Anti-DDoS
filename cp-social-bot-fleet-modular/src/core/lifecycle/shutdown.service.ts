import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { HandlerRegistryService } from '../registry/handler-registry.service';
import { BrowserService } from '../stealth/browser.service';

@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);

  constructor(
    private readonly registry: HandlerRegistryService,
    private readonly browser: BrowserService,
  ) {}

  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Shutdown initiated (signal: ${signal ?? 'none'})`);

    // 1. Stop accepting new work (dispatcher stops via its own onModuleDestroy)
    // 2. Shut down platform handlers (flush pending work)
    try {
      await this.registry.shutdownAll();
      this.logger.log('All platform handlers shut down');
    } catch (err) {
      this.logger.error('Error shutting down handlers', err);
    }

    // 3. Close browser instances
    try {
      await this.browser.closeAll();
      this.logger.log('Browser instances closed');
    } catch (err) {
      this.logger.error('Error closing browsers', err);
    }

    this.logger.log('Graceful shutdown complete');
  }
}
