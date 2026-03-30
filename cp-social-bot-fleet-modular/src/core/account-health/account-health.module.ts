import { Module } from '@nestjs/common';
import { AccountHealthService } from './account-health.service';

@Module({
  providers: [AccountHealthService],
  exports: [AccountHealthService],
})
export class AccountHealthModule {}
