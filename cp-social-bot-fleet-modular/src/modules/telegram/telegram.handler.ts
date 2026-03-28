// ============================================================
// TELEGRAM PLATFORM HANDLER
// ============================================================
// Implements the PlatformHandler interface for Telegram using
// the official Telegraf.js library (Bot API).
//
// Unlike browser-based platforms, Telegram uses a proper API,
// so no stealth/browser automation is needed. This makes
// Telegram the most reliable and fastest platform handler.
// ============================================================

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Task, Platform } from '@prisma/client';
import { Telegraf } from 'telegraf';
import { PlatformHandler } from '../../common/interfaces/platform-handler.interface';
import { TaskResult } from '../../common/interfaces/task-result.interface';
import { HandlerRegistryService } from '../../core/registry/handler-registry.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { PrismaService } from '../../core/database/prisma.service';

@Injectable()
export class TelegramHandler implements PlatformHandler, OnModuleInit {
  readonly platform = Platform.TELEGRAM;
  private readonly logger = new Logger(TelegramHandler.name);
  private bot: Telegraf | null = null;

  constructor(
    private readonly registry: HandlerRegistryService,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Register this handler with the central registry on startup */
  onModuleInit() {
    this.registry.register(this);
  }

  async initialize(): Promise<void> {
    const token = this.config.get<string>('app.telegramBotToken');
    if (token) {
      this.bot = new Telegraf(token);
      this.logger.log('Telegram bot initialized (global token)');
    } else {
      this.logger.warn(
        'No TELEGRAM_BOT_TOKEN — will use per-account tokens',
      );
    }
  }

  async executeTask(task: Task): Promise<TaskResult> {
    const payload = task.payload as Record<string, unknown>;

    try {
      const bot = await this.getBotForTask(task);
      if (!bot) {
        return {
          success: false,
          error: 'No Telegram bot token available',
        };
      }

      switch (task.type) {
        case 'SEND_MESSAGE':
          return await this.sendMessage(bot, payload);
        case 'POST_CONTENT':
          return await this.postContent(bot, payload);
        case 'SEND_DM':
          return await this.sendDm(bot, payload);
        default:
          return {
            success: false,
            error: `Unsupported Telegram task type: ${task.type}`,
          };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  async shutdown(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
    }
  }

  // ── Private methods ────────────────────────────────────

  /** Get a Telegraf bot instance — either global or per-account */
  private async getBotForTask(task: Task): Promise<Telegraf | null> {
    if (task.accountId) {
      const account = await this.prisma.account.findUnique({
        where: { id: task.accountId },
      });
      if (account) {
        const creds = this.crypto.decryptJson(
          account.encryptedCredentials,
        );
        if (creds.botToken) {
          return new Telegraf(creds.botToken as string);
        }
      }
    }
    return this.bot;
  }

  private async sendMessage(
    bot: Telegraf,
    payload: Record<string, unknown>,
  ): Promise<TaskResult> {
    const chatId = payload.chatId as string;
    const text = payload.text as string;

    if (!chatId || !text) {
      return {
        success: false,
        error: 'Missing chatId or text in payload',
      };
    }

    const result = await bot.telegram.sendMessage(chatId, text, {
      parse_mode: payload.parseMode as 'HTML' | 'Markdown' | undefined,
    });

    return {
      success: true,
      data: {
        messageId: result.message_id,
        chatId: result.chat.id,
      },
    };
  }

  private async postContent(
    bot: Telegraf,
    payload: Record<string, unknown>,
  ): Promise<TaskResult> {
    const chatId = payload.chatId as string;
    const text = payload.text as string;
    const photoUrl = payload.photoUrl as string | undefined;

    if (!chatId) {
      return { success: false, error: 'Missing chatId in payload' };
    }

    if (photoUrl) {
      const result = await bot.telegram.sendPhoto(chatId, photoUrl, {
        caption: text,
      });
      return {
        success: true,
        data: { messageId: result.message_id },
      };
    }

    const result = await bot.telegram.sendMessage(chatId, text ?? '');
    return {
      success: true,
      data: { messageId: result.message_id },
    };
  }

  private async sendDm(
    bot: Telegraf,
    payload: Record<string, unknown>,
  ): Promise<TaskResult> {
    // Telegram DMs are the same as regular messages
    return this.sendMessage(bot, payload);
  }
}
