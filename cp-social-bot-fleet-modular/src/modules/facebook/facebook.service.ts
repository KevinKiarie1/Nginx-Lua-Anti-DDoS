import { Injectable, Logger } from '@nestjs/common';
import { Platform, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { CreateAccountDto } from '../../common/dto/create-account.dto';

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async createAccount(dto: CreateAccountDto) {
    const encrypted = this.crypto.encryptJson(dto.credentials);
    return this.prisma.account.create({
      data: {
        platform: Platform.FACEBOOK,
        username: dto.username,
        encryptedCredentials: encrypted,
        metadata: (dto.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  async getAccounts() {
    return this.prisma.account.findMany({
      where: { platform: Platform.FACEBOOK, isActive: true },
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
      where: { id, platform: Platform.FACEBOOK },
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
