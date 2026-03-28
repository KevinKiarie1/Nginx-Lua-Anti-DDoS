// ============================================================
// SCHEDULES CONTROLLER — DB-Backed Cron Schedule API
// ============================================================
// CRUD endpoints for managing cron-like schedules.
// Schedules are stored in the DB and evaluated by the leader
// node's SchedulerService — not by @nestjs/schedule decorators.
// ============================================================

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/database/prisma.service';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
} from '../common/dto/create-schedule.dto';
import { validateTaskRequest } from '../common/task-capabilities';
import { RequireHealthy } from '../common/decorators/require-healthy.decorator';
import { ConsistencyGuard } from '../core/consistency/consistency.guard';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('api/schedules')
@UseGuards(ApiKeyGuard, ConsistencyGuard)
export class SchedulesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @RequireHealthy()
  @HttpCode(HttpStatus.CREATED)
  async createSchedule(@Body() dto: CreateScheduleDto) {
    validateTaskRequest({
      platform: dto.platform,
      type: dto.taskType,
      accountId: dto.accountId,
    });

    return this.prisma.schedule.create({
      data: {
        name: dto.name,
        cronExpr: dto.cronExpr,
        platform: dto.platform,
        taskType: dto.taskType,
        payload: dto.payload as Prisma.InputJsonValue,
        accountId: dto.accountId,
      },
    });
  }

  @Get()
  async getSchedules() {
    return this.prisma.schedule.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async getSchedule(@Param('id') id: string) {
    return this.prisma.schedule.findUnique({ where: { id } });
  }

  @Put(':id')
  @RequireHealthy()
  async updateSchedule(
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.prisma.schedule.update({
      where: { id },
      data: {
        ...(dto.cronExpr !== undefined ? { cronExpr: dto.cronExpr } : {}),
        ...(dto.payload !== undefined
          ? { payload: dto.payload as Prisma.InputJsonValue }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  @Delete(':id')
  @RequireHealthy()
  async deleteSchedule(@Param('id') id: string) {
    return this.prisma.schedule.delete({ where: { id } });
  }
}
