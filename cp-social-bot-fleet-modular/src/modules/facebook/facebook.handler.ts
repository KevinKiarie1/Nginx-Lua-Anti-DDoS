// ============================================================
// FACEBOOK PLATFORM HANDLER
// ============================================================
// Implements PlatformHandler for Facebook using Playwright
// with stealth anti-detection. Facebook has moderate bot
// detection but triggers on unusual activity patterns.
//
// Supported task types:
//   POST_CONTENT, LIKE_POST, COMMENT, SEND_DM
// ============================================================

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Task, Platform } from '@prisma/client';
import { PlatformHandler } from '../../common/interfaces/platform-handler.interface';
import { TaskResult } from '../../common/interfaces/task-result.interface';
import { HandlerRegistryService } from '../../core/registry/handler-registry.service';
import { BrowserService } from '../../core/stealth/browser.service';
import { HumanService } from '../../core/stealth/human.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { PrismaService } from '../../core/database/prisma.service';

@Injectable()
export class FacebookHandler implements PlatformHandler, OnModuleInit {
  readonly platform = Platform.FACEBOOK;
  private readonly logger = new Logger(FacebookHandler.name);

  constructor(
    private readonly registry: HandlerRegistryService,
    private readonly browser: BrowserService,
    private readonly human: HumanService,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async initialize(): Promise<void> {
    this.logger.log(
      'Facebook handler initialized (Playwright stealth)',
    );
  }

  async executeTask(task: Task): Promise<TaskResult> {
    const payload = task.payload as Record<string, unknown>;

    if (!task.accountId) {
      return {
        success: false,
        error: 'Facebook tasks require an accountId',
      };
    }

    try {
      switch (task.type) {
        case 'POST_CONTENT':
          return await this.postContent(task.accountId, payload);
        case 'LIKE_POST':
          return await this.likePost(task.accountId, payload);
        case 'COMMENT':
          return await this.comment(task.accountId, payload);
        case 'SEND_DM':
          return await this.sendMessage(task.accountId, payload);
        default:
          return {
            success: false,
            error: `Unsupported Facebook task type: ${task.type}`,
          };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  async shutdown(): Promise<void> {
    this.logger.log('Facebook handler shutting down');
  }

  // ── Private automation methods ─────────────────────────

  private async loginIfNeeded(accountId: string): Promise<void> {
    const page = await this.browser.createPage(accountId);
    try {
      await page.goto('https://www.facebook.com/', {
        waitUntil: 'networkidle',
      });
      await this.human.randomDelay(1000, 2000);

      // Check if already logged in
      const isLoggedIn = await page.$(
        '[aria-label="Your profile"]',
      );
      if (isLoggedIn) return;

      // Get credentials
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
      });
      if (!account) throw new Error('Account not found');
      const creds = this.crypto.decryptJson(
        account.encryptedCredentials,
      );

      // Type credentials
      await this.human.humanType(
        page,
        '#email',
        creds.email as string,
      );
      await this.human.randomDelay(300, 600);
      await this.human.humanType(
        page,
        '#pass',
        creds.password as string,
      );
      await this.human.randomDelay(500, 1000);

      // Submit
      await this.human.humanClick(
        page,
        'button[name="login"]',
      );
      await page.waitForNavigation({
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      this.logger.log(
        `Facebook: Logged in as ${creds.email}`,
      );
    } finally {
      await page.close();
    }
  }

  private async postContent(
    accountId: string,
    payload: Record<string, unknown>,
  ): Promise<TaskResult> {
    await this.loginIfNeeded(accountId);
    const page = await this.browser.createPage(accountId);

    try {
      await page.goto('https://www.facebook.com/', {
        waitUntil: 'networkidle',
      });
      await this.human.randomDelay(1000, 2000);

      // Click "What's on your mind?" to open post composer
      await this.human.humanClick(
        page,
        '[aria-label="Create a post"]',
      );
      await this.human.randomDelay(1000, 2000);

      // Type post text
      const text = payload.text as string;
      if (text) {
        await this.human.humanType(
          page,
          '[aria-label="What\'s on your mind?"]',
          text,
        );
        await this.human.randomDelay(500, 1000);
      }

      // Upload image if provided
      const imagePath = payload.imagePath as string;
      if (imagePath) {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(imagePath);
          await this.human.randomDelay(2000, 4000);
        }
      }

      // Click Post
      await this.human.humanClick(
        page,
        'div[aria-label="Post"]',
      );
      await this.human.randomDelay(3000, 6000);

      return {
        success: true,
        data: { platform: 'facebook', action: 'post_content' },
      };
    } finally {
      await page.close();
    }
  }

  private async likePost(
    accountId: string,
    payload: Record<string, unknown>,
  ): Promise<TaskResult> {
    await this.loginIfNeeded(accountId);
    const page = await this.browser.createPage(accountId);

    try {
      const postUrl = payload.postUrl as string;
      if (!postUrl)
        return { success: false, error: 'Missing postUrl' };

      await page.goto(postUrl, { waitUntil: 'networkidle' });
      await this.human.randomDelay(1000, 2000);
      await this.human.humanClick(
        page,
        '[aria-label="Like"]',
      );
      await this.human.randomDelay(500, 1000);

      return {
        success: true,
        data: {
          platform: 'facebook',
          action: 'like_post',
          postUrl,
        },
      };
    } finally {
      await page.close();
    }
  }

  private async comment(
    accountId: string,
    payload: Record<string, unknown>,
  ): Promise<TaskResult> {
    await this.loginIfNeeded(accountId);
    const page = await this.browser.createPage(accountId);

    try {
      const postUrl = payload.postUrl as string;
      const text = payload.text as string;
      if (!postUrl || !text)
        return {
          success: false,
          error: 'Missing postUrl or text',
        };

      await page.goto(postUrl, { waitUntil: 'networkidle' });
      await this.human.randomDelay(1000, 2000);

      // Click comment box
      await this.human.humanClick(
        page,
        '[aria-label="Write a comment"]',
      );
      await this.human.randomDelay(500, 1000);

      // Type comment
      await this.human.humanType(
        page,
        '[aria-label="Write a comment"]',
        text,
      );
      await this.human.randomDelay(300, 600);

      // Submit with Enter
      await page.keyboard.press('Enter');
      await this.human.randomDelay(1000, 2000);

      return {
        success: true,
        data: {
          platform: 'facebook',
          action: 'comment',
          postUrl,
        },
      };
    } finally {
      await page.close();
    }
  }

  private async sendMessage(
    accountId: string,
    payload: Record<string, unknown>,
  ): Promise<TaskResult> {
    await this.loginIfNeeded(accountId);
    const page = await this.browser.createPage(accountId);

    try {
      const recipientUrl = payload.recipientUrl as string;
      const text = payload.text as string;
      if (!text)
        return { success: false, error: 'Missing text' };

      await page.goto(
        recipientUrl ?? 'https://www.facebook.com/messages/',
        { waitUntil: 'networkidle' },
      );
      await this.human.randomDelay(1000, 2000);

      // Type message
      await this.human.humanType(
        page,
        '[aria-label="Message"]',
        text,
      );
      await this.human.randomDelay(300, 600);

      // Send
      await page.keyboard.press('Enter');
      await this.human.randomDelay(500, 1000);

      return {
        success: true,
        data: { platform: 'facebook', action: 'send_dm' },
      };
    } finally {
      await page.close();
    }
  }
}
