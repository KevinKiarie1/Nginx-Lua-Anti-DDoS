import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/database/prisma.service';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
} from '../common/dto/create-schedule.dto';
import { validateTaskRequest } from '../common/task-capabilities';

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateScheduleDto) {
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

  async findAll(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.schedule.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.schedule.count(),
    ]);
    return { items, total, page, limit };
  }

  async findOne(id: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id },
    });
    if (!schedule) throw new NotFoundException(`Schedule ${id} not found`);
    return schedule;
  }

  async update(id: string, dto: UpdateScheduleDto) {
    await this.findOne(id); // throws 404 if missing
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

  async remove(id: string) {
    await this.findOne(id); // throws 404 if missing
    return this.prisma.schedule.delete({ where: { id } });
  }
}
