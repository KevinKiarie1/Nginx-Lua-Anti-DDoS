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
  ParseUUIDPipe,
} from '@nestjs/common';
import { TaskQueueService } from '../core/queue/task-queue.service';
import {
  ConsistencyService,
  ClusterHealth,
  ClusterHealthSnapshot,
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
  async getTask(@Param('id', ParseUUIDPipe) id: string) {
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
    const snapshot = await this.consistency.getHealthSnapshot(true);
    return {
      status: this.getStatus(snapshot),
      health: snapshot.health,
      instanceId: process.env.INSTANCE_ID ?? 'default',
      isLeader: snapshot.isLeader,
      databaseReachable: snapshot.databaseReachable,
      writeSafe: snapshot.writeSafe,
      selfRegistered: snapshot.selfRegistered,
      aliveNodeCount: snapshot.aliveNodeCount,
      requiredNodeCount: snapshot.requiredNodeCount,
      nodeQuorumMet: snapshot.nodeQuorumMet,
      schedulerLeaseOwnerId: snapshot.schedulerLeaseOwnerId,
      schedulerLeaseExpiresAt: snapshot.schedulerLeaseExpiresAt,
      schedulerReady: snapshot.schedulerReady,
      checkedAt: snapshot.checkedAt.toISOString(),
      timestamp: new Date().toISOString(),
    };
  }

  private getStatus(snapshot: ClusterHealthSnapshot): string {
    if (snapshot.health === ClusterHealth.HEALTHY) {
      return 'ok';
    }

    return snapshot.writeSafe ? 'degraded' : 'error';
  }
}
