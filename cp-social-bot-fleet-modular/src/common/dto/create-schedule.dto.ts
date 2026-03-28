import {
  IsEnum,
  IsString,
  IsOptional,
  IsObject,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { Platform, TaskType } from '@prisma/client';

export class CreateScheduleDto {
  @IsString()
  name!: string;

  /** Cron expression, e.g. "0 *\/6 * * *" (every 6 hours) */
  @IsString()
  cronExpr!: string;

  @IsEnum(Platform)
  platform!: Platform;

  @IsEnum(TaskType)
  taskType!: TaskType;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  cronExpr?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
