// ============================================================
// CONFIG MODULE
// ============================================================
// Wraps @nestjs/config with validation and typed config access.
// Loaded as a global module so all other modules can inject
// ConfigService without re-importing.
// ============================================================

import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { appConfig } from './app.config';
import { validateEnvironment } from './config.validation';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      validate: validateEnvironment,
      envFilePath: '.env',
    }),
  ],
})
export class ConfigModule {}
