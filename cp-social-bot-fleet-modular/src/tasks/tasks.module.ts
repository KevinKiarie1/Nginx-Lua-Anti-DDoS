import { Module } from '@nestjs/common';
import { TaskDispatcherService } from './task-dispatcher.service';
import { TasksController } from './tasks.controller';
import { SchedulesController } from './schedules.controller';

@Module({
  controllers: [TasksController, SchedulesController],
  providers: [TaskDispatcherService],
  exports: [TaskDispatcherService],
})
export class TasksModule {}
