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
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
} from '../common/dto/create-schedule.dto';
import { RequireHealthy } from '../common/decorators/require-healthy.decorator';
import { ConsistencyGuard } from '../core/consistency/consistency.guard';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { SchedulesService } from './schedules.service';

@Controller('api/schedules')
@UseGuards(ApiKeyGuard, ConsistencyGuard)
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Post()
  @RequireHealthy()
  @HttpCode(HttpStatus.CREATED)
  async createSchedule(@Body() dto: CreateScheduleDto) {
    return this.schedulesService.create(dto);
  }

  @Get()
  async getSchedules(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.schedulesService.findAll(
      Math.max(1, page),
      Math.min(Math.max(1, limit), 200),
    );
  }

  @Get(':id')
  async getSchedule(@Param('id') id: string) {
    return this.schedulesService.findOne(id);
  }

  @Put(':id')
  @RequireHealthy()
  async updateSchedule(
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.schedulesService.update(id, dto);
  }

  @Delete(':id')
  @RequireHealthy()
  async deleteSchedule(@Param('id') id: string) {
    return this.schedulesService.remove(id);
  }
}
