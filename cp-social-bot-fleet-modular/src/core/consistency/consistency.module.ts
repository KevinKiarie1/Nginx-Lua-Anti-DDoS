import { Module, Global } from '@nestjs/common';
import { ConsistencyService } from './consistency.service';
import { ConsistencyGuard } from './consistency.guard';

@Global()
@Module({
  providers: [ConsistencyService, ConsistencyGuard],
  exports: [ConsistencyService, ConsistencyGuard],
})
export class ConsistencyModule {}
