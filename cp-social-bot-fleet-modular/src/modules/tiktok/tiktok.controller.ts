import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TiktokService } from './tiktok.service';
import { CreateAccountDto } from '../../common/dto/create-account.dto';
import { RequireHealthy } from '../../common/decorators/require-healthy.decorator';
import { ConsistencyGuard } from '../../core/consistency/consistency.guard';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';

@Controller('api/tiktok')
@UseGuards(ApiKeyGuard, ConsistencyGuard)
export class TiktokController {
  constructor(private readonly tiktokService: TiktokService) {}

  @Post('accounts')
  @RequireHealthy()
  @HttpCode(HttpStatus.CREATED)
  async createAccount(@Body() dto: CreateAccountDto) {
    return this.tiktokService.createAccount(dto);
  }

  @Get('accounts')
  async getAccounts() {
    return this.tiktokService.getAccounts();
  }

  @Get('accounts/:id')
  async getAccount(@Param('id', ParseUUIDPipe) id: string) {
    return this.tiktokService.getAccount(id);
  }
}
