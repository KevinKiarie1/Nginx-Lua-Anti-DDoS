// ============================================================
// MAIN ENTRY POINT — CP-SOCIAL-BOT-FLEET-MODULAR
// ============================================================
// Boots the NestJS application as a single modular monolith.
// All platform modules, the core infrastructure, and the
// REST API run within one process — but with strict module
// boundaries enforced by NestJS's DI container.
//
// The application:
// 1. Validates environment (fail-fast on misconfiguration)
// 2. Connects to CockroachDB (SERIALIZABLE isolation)
// 3. Registers cluster node and starts heartbeat
// 4. Initializes platform handlers (Telegraf, Playwright)
// 5. Starts the task dispatcher (polls queue)
// 6. Starts the schedule evaluator (leader-only)
// 7. Exposes REST API on configured port
// ============================================================

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Security hardening
  app.use(helmet());
  app.enableCors();

  // Global validation pipe — validates all incoming DTOs
  // with whitelist stripping + transform enabled
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter for consistent error responses
  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log('=== CP-SOCIAL-BOT-FLEET-MODULAR ===');
  logger.log(`Modular monolith running on port ${port}`);
  logger.log(`Instance: ${process.env.INSTANCE_ID ?? 'default'}`);
  logger.log('Architecture: NestJS Modular Monolith');
  logger.log('Database: CockroachDB (CP — SERIALIZABLE isolation)');
  logger.log(
    'CAP: Consistency + Partition Tolerance (sacrifices Availability)',
  );
}

bootstrap();
