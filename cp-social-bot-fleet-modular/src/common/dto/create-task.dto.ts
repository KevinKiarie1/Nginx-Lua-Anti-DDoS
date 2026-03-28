import {
  IsEnum,
  IsOptional,
  IsString,
  IsObject,
  IsInt,
  Min,
  Max,
  IsUUID,
} from 'class-validator';
import { Platform, TaskType } from '@prisma/client';

export class CreateTaskDto {
  @IsEnum(TaskType)
  type!: TaskType;

  @IsEnum(Platform)
  platform!: Platform;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;
}
