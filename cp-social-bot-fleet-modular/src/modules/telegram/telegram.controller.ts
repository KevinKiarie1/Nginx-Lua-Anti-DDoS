// ============================================================
// TELEGRAM CONTROLLER
// ============================================================
// REST API endpoints specific to Telegram operations.
// Protected by API key auth and CP health guard.
// ============================================================

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { CreateAccountDto } from '../../common/dto/create-account.dto';
import { RequireHealthy } from '../../common/decorators/require-healthy.decorator';
import { ConsistencyGuard } from '../../core/consistency/consistency.guard';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';

@Controller('api/telegram')
@UseGuards(ApiKeyGuard, ConsistencyGuard)
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post('accounts')
  @RequireHealthy()
  @HttpCode(HttpStatus.CREATED)
  async createAccount(@Body() dto: CreateAccountDto) {
    return this.telegramService.createAccount(dto);
  }

  @Get('accounts')
  async getAccounts() {
    return this.telegramService.getAccounts();
  }

  @Get('accounts/:id')
  async getAccount(@Param('id') id: string) {
    return this.telegramService.getAccount(id);
  }
}
