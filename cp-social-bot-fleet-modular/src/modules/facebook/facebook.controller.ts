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
import { FacebookService } from './facebook.service';
import { CreateAccountDto } from '../../common/dto/create-account.dto';
import { RequireHealthy } from '../../common/decorators/require-healthy.decorator';
import { ConsistencyGuard } from '../../core/consistency/consistency.guard';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';

@Controller('api/facebook')
@UseGuards(ApiKeyGuard, ConsistencyGuard)
export class FacebookController {
  constructor(
    private readonly facebookService: FacebookService,
  ) {}

  @Post('accounts')
  @RequireHealthy()
  @HttpCode(HttpStatus.CREATED)
  async createAccount(@Body() dto: CreateAccountDto) {
    return this.facebookService.createAccount(dto);
  }

  @Get('accounts')
  async getAccounts() {
    return this.facebookService.getAccounts();
  }

  @Get('accounts/:id')
  async getAccount(@Param('id') id: string) {
    return this.facebookService.getAccount(id);
  }
}
