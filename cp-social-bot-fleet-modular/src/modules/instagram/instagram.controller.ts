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
import { InstagramService } from './instagram.service';
import { CreateAccountDto } from '../../common/dto/create-account.dto';
import { RequireHealthy } from '../../common/decorators/require-healthy.decorator';
import { ConsistencyGuard } from '../../core/consistency/consistency.guard';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';

@Controller('api/instagram')
@UseGuards(ApiKeyGuard, ConsistencyGuard)
export class InstagramController {
  constructor(
    private readonly instagramService: InstagramService,
  ) {}

  @Post('accounts')
  @RequireHealthy()
  @HttpCode(HttpStatus.CREATED)
  async createAccount(@Body() dto: CreateAccountDto) {
    return this.instagramService.createAccount(dto);
  }

  @Get('accounts')
  async getAccounts() {
    return this.instagramService.getAccounts();
  }

  @Get('accounts/:id')
  async getAccount(@Param('id', ParseUUIDPipe) id: string) {
    return this.instagramService.getAccount(id);
  }
}
