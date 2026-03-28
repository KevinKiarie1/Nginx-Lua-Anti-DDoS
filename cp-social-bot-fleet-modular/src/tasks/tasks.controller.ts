// ============================================================
// TASKS CONTROLLER — Cross-Platform Task & Queue API
// ============================================================
// REST endpoints for creating tasks, viewing queue stats, and
// checking system health. These are platform-agnostic — the
// task dispatcher routes tasks to the correct platform handler.
//
// All write operations require a healthy cluster (CP gate).
// Protected by API key authentication.
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
import { TaskQueueService } from '../core/queue/task-queue.service';
import {
  ConsistencyService,
  ClusterHealth,
} from '../core/consistency/consistency.service';
import { CreateTaskDto } from '../common/dto/create-task.dto';
import { RequireHealthy } from '../common/decorators/require-healthy.decorator';
import { ConsistencyGuard } from '../core/consistency/consistency.guard';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('api')
@UseGuards(ApiKeyGuard, ConsistencyGuard)
export class TasksController {
  constructor(
    private readonly queue: TaskQueueService,
    private readonly consistency: ConsistencyService,
  ) {}

  /** Create a new task in the queue */
  @Post('tasks')
  @RequireHealthy()
  @HttpCode(HttpStatus.CREATED)
  async createTask(@Body() dto: CreateTaskDto) {
    return this.queue.createTask(dto);
  }

  /** Get a specific task by ID */
  @Get('tasks/:id')
  async getTask(@Param('id') id: string) {
    return this.queue.getTask(id);
  }

  /** Get queue statistics (pending, running, completed, etc.) */
  @Get('queue/stats')
  async getQueueStats() {
    return this.queue.getQueueStats();
  }

  /**
   * Health check endpoint.
   * Returns cluster health, leader status, and instance info.
   * Does NOT require healthy cluster (so monitoring works during partitions).
   */
  @Get('health')
  async getHealth() {
    const health = await this.consistency.checkHealth();
    return {
      status: health === ClusterHealth.HEALTHY ? 'ok' : 'degraded',
      health,
      instanceId: process.env.INSTANCE_ID ?? 'default',
      isLeader: this.consistency.getIsLeader(),
      timestamp: new Date().toISOString(),
    };
  }
}
