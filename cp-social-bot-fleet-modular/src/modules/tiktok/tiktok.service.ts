import { Injectable, Logger } from '@nestjs/common';
import { Platform, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { CreateAccountDto } from '../../common/dto/create-account.dto';

@Injectable()
export class TiktokService {
  private readonly logger = new Logger(TiktokService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async createAccount(dto: CreateAccountDto) {
    const encrypted = this.crypto.encryptJson(dto.credentials);
    return this.prisma.account.create({
      data: {
        platform: Platform.TIKTOK,
        username: dto.username,
        encryptedCredentials: encrypted,
        metadata: (dto.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  async getAccounts() {
    return this.prisma.account.findMany({
      where: { platform: Platform.TIKTOK, isActive: true },
      select: {
        id: true,
        username: true,
        isActive: true,
        createdAt: true,
        metadata: true,
      },
    });
  }

  async getAccount(id: string) {
    return this.prisma.account.findFirst({
      where: { id, platform: Platform.TIKTOK },
      select: {
        id: true,
        username: true,
        isActive: true,
        createdAt: true,
        metadata: true,
      },
    });
  }
}
