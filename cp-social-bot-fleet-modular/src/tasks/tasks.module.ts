import { Module } from '@nestjs/common';
import { TaskDispatcherService } from './task-dispatcher.service';
import { TasksController } from './tasks.controller';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  controllers: [TasksController, SchedulesController],
  providers: [TaskDispatcherService, SchedulesService],
  exports: [TaskDispatcherService],
})
export class TasksModule {}
