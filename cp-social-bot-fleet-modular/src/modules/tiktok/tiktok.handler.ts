// ============================================================
// TIKTOK PLATFORM HANDLER
// ============================================================
// Implements PlatformHandler for TikTok using Playwright with
// full stealth plugins. TikTok has aggressive bot detection,
// so we employ:
//   - Stealth browser contexts (unique fingerprint per account)
//   - Human-like behavioral simulation (Bezier mouse, typing)
//   - Canvas/WebGL fingerprint spoofing
//   - Proxy rotation per account
//
// Supported task types:
//   POST_CONTENT, LIKE_POST, COMMENT, FOLLOW_USER, SEND_DM
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
export class TiktokHandler implements PlatformHandler, OnModuleInit {
  readonly platform = Platform.TIKTOK;
  private readonly logger = new Logger(TiktokHandler.name);

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
    this.logger.log('TikTok handler initialized (Playwright stealth)');
  }

  async executeTask(task: Task): Promise<TaskResult> {
    const payload = task.payload as Record<string, unknown>;

    if (!task.accountId) {
      return {
        success: false,
        error: 'TikTok tasks require an accountId',
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
        case 'FOLLOW_USER':
          return await this.followUser(task.accountId, payload);
        case 'SEND_DM':
          return await this.sendDm(task.accountId, payload);
        default:
          return {
            success: false,
            error: `Unsupported TikTok task type: ${task.type}`,
          };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  async shutdown(): Promise<void> {
    this.logger.log('TikTok handler shutting down');
  }

  // ── Private automation methods ─────────────────────────

  private async loginIfNeeded(accountId: string): Promise<void> {
    const page = await this.browser.createPage(accountId);
    try {
      await page.goto('https://www.tiktok.com', {
        waitUntil: 'networkidle',
      });
      await this.human.randomDelay(1000, 2000);

      // Check if already logged in
      const isLoggedIn = await page.$('[data-e2e="profile-icon"]');
      if (isLoggedIn) return;

      // Get credentials
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
      });
      if (!account) throw new Error('Account not found');
      const creds = this.crypto.decryptJson(
        account.encryptedCredentials,
      );

      // Navigate to login
      await this.human.humanClick(
        page,
        '[data-e2e="top-login-button"]',
      );
      await this.human.randomDelay(500, 1000);

      // Type credentials with human-like behavior
      await this.human.humanType(
        page,
        'input[name="username"]',
        creds.username as string,
      );
      await this.human.randomDelay(300, 600);
      await this.human.humanType(
        page,
        'input[type="password"]',
        creds.password as string,
      );
      await this.human.randomDelay(500, 1000);

      // Submit
      await this.human.humanClick(page, '[data-e2e="login-button"]');
      await page.waitForNavigation({
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      this.logger.log(`TikTok: Logged in as ${creds.username}`);
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
      await page.goto('https://www.tiktok.com/upload', {
        waitUntil: 'networkidle',
      });
      await this.human.randomDelay(2000, 4000);

      // Upload video file
      const videoPath = payload.videoPath as string;
      if (videoPath) {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(videoPath);
          await this.human.randomDelay(3000, 5000);
        }
      }

      // Add caption
      const caption = payload.caption as string;
      if (caption) {
        const captionInput = await page.$(
          '[data-e2e="upload-caption"]',
        );
        if (captionInput) {
          await this.human.humanType(
            page,
            '[data-e2e="upload-caption"]',
            caption,
          );
          await this.human.randomDelay(500, 1000);
        }
      }

      // Click post button
      await this.human.humanClick(page, '[data-e2e="upload-btn"]');
      await this.human.randomDelay(5000, 10000);

      return {
        success: true,
        data: { platform: 'tiktok', action: 'post_content' },
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
      await this.human.humanScroll(page, 300);
      await this.human.humanClick(page, '[data-e2e="like-icon"]');
      await this.human.randomDelay(500, 1000);

      return {
        success: true,
        data: { platform: 'tiktok', action: 'like_post', postUrl },
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
      await this.human.randomDelay(1000, 3000);
      await this.human.humanClick(page, '[data-e2e="comment-icon"]');
      await this.human.randomDelay(500, 1000);
      await this.human.humanType(
        page,
        '[data-e2e="comment-input"]',
        text,
      );
      await this.human.randomDelay(300, 600);
      await this.human.humanClick(page, '[data-e2e="comment-post"]');
      await this.human.randomDelay(1000, 2000);

      return {
        success: true,
        data: { platform: 'tiktok', action: 'comment', postUrl },
      };
    } finally {
      await page.close();
    }
  }

  private async followUser(
    accountId: string,
    payload: Record<string, unknown>,
  ): Promise<TaskResult> {
    await this.loginIfNeeded(accountId);
    const page = await this.browser.createPage(accountId);

    try {
      const profileUrl = payload.profileUrl as string;
      if (!profileUrl)
        return { success: false, error: 'Missing profileUrl' };

      await page.goto(profileUrl, { waitUntil: 'networkidle' });
      await this.human.randomDelay(1000, 2000);
      await this.human.humanClick(
        page,
        '[data-e2e="follow-button"]',
      );
      await this.human.randomDelay(500, 1000);

      return {
        success: true,
        data: {
          platform: 'tiktok',
          action: 'follow_user',
          profileUrl,
        },
      };
    } finally {
      await page.close();
    }
  }

  private async sendDm(
    accountId: string,
    payload: Record<string, unknown>,
  ): Promise<TaskResult> {
    await this.loginIfNeeded(accountId);
    const page = await this.browser.createPage(accountId);

    try {
      const recipientUrl = payload.recipientUrl as string;
      const text = payload.text as string;
      if (!text) return { success: false, error: 'Missing text' };

      await page.goto(
        recipientUrl ?? 'https://www.tiktok.com/messages',
        { waitUntil: 'networkidle' },
      );
      await this.human.randomDelay(1000, 2000);
      await this.human.humanType(
        page,
        '[data-e2e="message-input"]',
        text,
      );
      await this.human.randomDelay(300, 600);
      await this.human.humanClick(
        page,
        '[data-e2e="send-message"]',
      );
      await this.human.randomDelay(500, 1000);

      return {
        success: true,
        data: { platform: 'tiktok', action: 'send_dm' },
      };
    } finally {
      await page.close();
    }
  }
}
