// ============================================================
// INSTAGRAM PLATFORM HANDLER
// ============================================================
// Implements PlatformHandler for Instagram using Playwright
// with stealth anti-detection. Instagram has strong bot
// detection, so we use the same stealth stack as TikTok:
//   - Unique browser context per account
//   - Human behavioral simulation
//   - Fingerprint spoofing
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
export class InstagramHandler implements PlatformHandler, OnModuleInit {
  readonly platform = Platform.INSTAGRAM;
  private readonly logger = new Logger(InstagramHandler.name);

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
      'Instagram handler initialized (Playwright stealth)',
    );
  }

  async executeTask(task: Task): Promise<TaskResult> {
    const payload = task.payload as Record<string, unknown>;

    if (!task.accountId) {
      return {
        success: false,
        error: 'Instagram tasks require an accountId',
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
            error: `Unsupported Instagram task type: ${task.type}`,
          };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  async shutdown(): Promise<void> {
    this.logger.log('Instagram handler shutting down');
  }

  // ── Private automation methods ─────────────────────────

  private async loginIfNeeded(accountId: string): Promise<void> {
    const page = await this.browser.createPage(accountId);
    try {
      await page.goto('https://www.instagram.com/', {
        waitUntil: 'networkidle',
      });
      await this.human.randomDelay(1000, 2000);

      // Check if already logged in (profile icon visible)
      const isLoggedIn = await page.$(
        'svg[aria-label="Home"]',
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

      // Type username/password with human simulation
      await this.human.humanType(
        page,
        'input[name="username"]',
        creds.username as string,
      );
      await this.human.randomDelay(300, 600);
      await this.human.humanType(
        page,
        'input[name="password"]',
        creds.password as string,
      );
      await this.human.randomDelay(500, 1000);

      // Submit login
      await this.human.humanClick(
        page,
        'button[type="submit"]',
      );
      await page.waitForNavigation({
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Dismiss "Save Login Info" dialog if it appears
      const notNowBtn = await page.$(
        'button:has-text("Not Now")',
      );
      if (notNowBtn) {
        await this.human.randomDelay(500, 1000);
        await notNowBtn.click();
      }

      this.logger.log(
        `Instagram: Logged in as ${creds.username}`,
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
      await page.goto('https://www.instagram.com/', {
        waitUntil: 'networkidle',
      });
      await this.human.randomDelay(1000, 2000);

      // Click "New Post" button
      await this.human.humanClick(
        page,
        'svg[aria-label="New post"]',
      );
      await this.human.randomDelay(1000, 2000);

      // Upload image/video
      const filePath = (payload.imagePath ?? payload.videoPath) as string;
      if (filePath) {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(filePath);
          await this.human.randomDelay(2000, 4000);
        }
      }

      // Click through to caption step
      const nextBtn = await page.$(
        'button:has-text("Next")',
      );
      if (nextBtn) {
        await nextBtn.click();
        await this.human.randomDelay(1000, 2000);
        // Click Next again to get to caption
        const nextBtn2 = await page.$(
          'button:has-text("Next")',
        );
        if (nextBtn2) await nextBtn2.click();
        await this.human.randomDelay(1000, 2000);
      }

      // Add caption
      const caption = payload.caption as string;
      if (caption) {
        await this.human.humanType(
          page,
          'textarea[aria-label="Write a caption..."]',
          caption,
        );
        await this.human.randomDelay(500, 1000);
      }

      // Share
      await this.human.humanClick(
        page,
        'button:has-text("Share")',
      );
      await this.human.randomDelay(5000, 10000);

      return {
        success: true,
        data: { platform: 'instagram', action: 'post_content' },
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
        'svg[aria-label="Like"]',
      );
      await this.human.randomDelay(500, 1000);

      return {
        success: true,
        data: {
          platform: 'instagram',
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

      // Click comment icon
      await this.human.humanClick(
        page,
        'svg[aria-label="Comment"]',
      );
      await this.human.randomDelay(500, 1000);

      // Type comment
      await this.human.humanType(
        page,
        'textarea[aria-label="Add a comment…"]',
        text,
      );
      await this.human.randomDelay(300, 600);

      // Post comment
      await this.human.humanClick(
        page,
        'button:has-text("Post")',
      );
      await this.human.randomDelay(1000, 2000);

      return {
        success: true,
        data: {
          platform: 'instagram',
          action: 'comment',
          postUrl,
        },
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
        'button:has-text("Follow")',
      );
      await this.human.randomDelay(500, 1000);

      return {
        success: true,
        data: {
          platform: 'instagram',
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
      const recipientUsername = payload.recipientUsername as string;
      const text = payload.text as string;
      if (!text)
        return { success: false, error: 'Missing text' };

      // Navigate to DM inbox
      await page.goto('https://www.instagram.com/direct/inbox/', {
        waitUntil: 'networkidle',
      });
      await this.human.randomDelay(1000, 2000);

      if (recipientUsername) {
        // New message flow
        await this.human.humanClick(
          page,
          'svg[aria-label="New message"]',
        );
        await this.human.randomDelay(500, 1000);
        await this.human.humanType(
          page,
          'input[name="queryBox"]',
          recipientUsername,
        );
        await this.human.randomDelay(1000, 2000);

        // Select first result
        const firstResult = await page.$(
          'div[role="listbox"] button',
        );
        if (firstResult) {
          await firstResult.click();
          await this.human.randomDelay(500, 1000);
        }

        await this.human.humanClick(
          page,
          'button:has-text("Chat")',
        );
        await this.human.randomDelay(1000, 2000);
      }

      // Type and send message
      await this.human.humanType(
        page,
        'textarea[placeholder="Message..."]',
        text,
      );
      await this.human.randomDelay(300, 600);
      await this.human.humanClick(
        page,
        'button:has-text("Send")',
      );
      await this.human.randomDelay(500, 1000);

      return {
        success: true,
        data: { platform: 'instagram', action: 'send_dm' },
      };
    } finally {
      await page.close();
    }
  }
}
