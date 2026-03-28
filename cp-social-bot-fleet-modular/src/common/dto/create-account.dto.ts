import { IsEnum, IsString, IsOptional, IsObject, IsBoolean } from 'class-validator';
import { Platform } from '@prisma/client';

export class CreateAccountDto {
  @IsEnum(Platform)
  platform!: Platform;

  @IsString()
  username!: string;

  /** Raw credentials object — will be AES-256-GCM encrypted before storage */
  @IsObject()
  credentials!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
