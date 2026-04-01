// ============================================================
// BROWSER SERVICE — Stealth Playwright Launcher
// ============================================================
// Launches Playwright Chromium browsers with anti-detection:
// - navigator.webdriver override
// - Canvas/WebGL fingerprint noise injection
// - Realistic viewport and user-agent rotation
// - Plugin/language spoofing
// - Chrome runtime mock
//
// Used by TikTok, Instagram, and Facebook modules.
// Telegram uses the Bot API directly (no browser needed).
//
// Each account gets its own isolated BrowserContext with a
// unique fingerprint to prevent cross-account detection.
// ============================================================

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { ProxyService } from '../proxy/proxy.service';
import * as fs from 'fs';
import * as path from 'path';
import UserAgent = require('user-agents');

/** Tracked browser context with last-used timestamp for LRU eviction */
interface TrackedContext {
  context: BrowserContext;
  lastUsedAt: number;
}

@Injectable()
export class BrowserService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserService.name);
  private browser: Browser | null = null;
  private readonly contexts = new Map<string, TrackedContext>();
  private readonly sessionDir: string;
  private readonly maxContexts: number;
  private readonly contextIdleMs: number;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly proxy: ProxyService,
  ) {
    this.sessionDir = this.config.get<string>('app.sessionStorageDir')!;
    this.maxContexts = this.config.get<number>('app.browserMaxContexts')!;
    this.contextIdleMs = this.config.get<number>('app.browserContextIdleMs')!;

    // Ensure session directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    // Sweep idle contexts every 60 seconds
    this.evictionTimer = setInterval(() => {
      this.evictIdleContexts().catch((err) =>
        this.logger.warn('Context eviction sweep failed', err),
      );
    }, 60_000);
  }

  async onModuleDestroy() {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    await this.closeAll();
  }

  /** Launch or reuse the shared browser instance */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      const headless = this.config.get<boolean>('app.browserHeadless')!;
      const slowMo = this.config.get<number>('app.browserSlowMo')!;

      this.browser = await chromium.launch({
        headless,
        slowMo,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });

      this.logger.log(`Browser launched (headless: ${headless})`);
    }
    return this.browser;
  }

  /**
   * Create a stealth browser context for a specific account.
   * Each account gets its own isolated context with a unique
   * fingerprint — preventing cross-account correlation.
   *
   * LRU eviction: If the context pool is at capacity, the
   * least-recently-used context is saved and closed before
   * creating a new one.
   */
  async createStealthContext(accountId: string): Promise<BrowserContext> {
    // Reuse existing context for this account
    const existing = this.contexts.get(accountId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.context;
    }

    // Evict LRU context if at capacity
    if (this.contexts.size >= this.maxContexts) {
      await this.evictLru();
    }

    const browser = await this.getBrowser();
    const ua = new UserAgent({ deviceCategory: 'desktop' });
    const proxyConfig = this.proxy.getProxyForAccount(accountId);

    // Restore previous session state if it exists on disk
    const sessionPath = path.join(this.sessionDir, `${accountId}.json`);
    let storageState: string | undefined;
    if (fs.existsSync(sessionPath)) {
      storageState = sessionPath;
      this.logger.debug(
        `Restoring session state for account ${accountId}`,
      );
    }

    const context = await browser.newContext({
      userAgent: ua.toString(),
      viewport: {
        width: 1280 + this.randomInt(-100, 100),
        height: 720 + this.randomInt(-50, 50),
      },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      ...(storageState ? { storageState } : {}),
      ...(proxyConfig
        ? {
            proxy: {
              server: proxyConfig.server,
              username: proxyConfig.username,
              password: proxyConfig.password,
            },
          }
        : {}),
    });

    // Inject stealth init scripts into every page opened in this context.
    // Passed as a string to avoid TypeScript DOM type-checking —
    // this code executes in the browser, not in Node.js.
    await context.addInitScript(`
      // Override navigator.webdriver (primary automation detection)
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      // Fake plugins array (empty = headless detection)
      Object.defineProperty(navigator, 'plugins', {
        get: () =>
          [1, 2, 3, 4, 5].map(() => ({
            name: 'Plugin',
            filename: 'plugin.dll',
          })),
      });

      // Fake languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Canvas fingerprint noise — adds imperceptible randomness
      var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (type) {
        var ctx = this.getContext('2d');
        if (ctx) {
          var noise = Math.random() * 0.01;
          ctx.globalAlpha = 1 - noise;
        }
        return origToDataURL.call(this, type);
      };

      // WebGL fingerprint noise — spoofs GPU vendor/renderer
      var origGetParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (param) {
        if (param === 37445) return 'Intel Inc.';
        if (param === 37446) return 'Intel Iris OpenGL Engine';
        return origGetParam.call(this, param);
      };

      // Chrome runtime mock (missing in headless = detection)
      window.chrome = { runtime: {} };
    `);

    this.contexts.set(accountId, {
      context,
      lastUsedAt: Date.now(),
    });
    this.logger.debug(
      `Stealth context created for account ${accountId} ` +
        `(${this.contexts.size}/${this.maxContexts} slots)`,
    );
    return context;
  }

  /** Create a new page in an account's stealth context */
  async createPage(accountId: string): Promise<Page> {
    const context = await this.createStealthContext(accountId);
    // Touch LRU timestamp on every page creation
    const tracked = this.contexts.get(accountId);
    if (tracked) tracked.lastUsedAt = Date.now();
    return context.newPage();
  }

  /** Close a specific account's context, persisting session state */
  async closeContext(accountId: string): Promise<void> {
    const tracked = this.contexts.get(accountId);
    if (tracked) {
      await this.saveSession(accountId, tracked.context);
      await tracked.context.close();
      this.contexts.delete(accountId);
    }
  }

  /** Close all contexts and the browser, persisting all sessions */
  async closeAll(): Promise<void> {
    for (const [id, tracked] of this.contexts) {
      await this.saveSession(id, tracked.context).catch(() => {});
      await tracked.context.close().catch(() => {});
      this.contexts.delete(id);
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.logger.log('Browser and all contexts closed (sessions saved)');
  }

  // ── LRU / Idle context eviction ───────────────────────

  /** Evict the single least-recently-used context to free a slot */
  private async evictLru(): Promise<void> {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, tracked] of this.contexts) {
      if (tracked.lastUsedAt < oldestTime) {
        oldestTime = tracked.lastUsedAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.logger.log(`Evicting LRU context for account ${oldestId}`);
      await this.closeContext(oldestId);
    }
  }

  /** Periodic sweep: close contexts that have been idle beyond the TTL */
  private async evictIdleContexts(): Promise<void> {
    const now = Date.now();
    const toEvict: string[] = [];

    for (const [id, tracked] of this.contexts) {
      if (now - tracked.lastUsedAt > this.contextIdleMs) {
        toEvict.push(id);
      }
    }

    for (const id of toEvict) {
      this.logger.log(`Evicting idle context for account ${id}`);
      await this.closeContext(id).catch((err) =>
        this.logger.warn(`Failed to evict context ${id}`, err),
      );
    }

    if (toEvict.length > 0) {
      this.logger.log(
        `Evicted ${toEvict.length} idle context(s), ` +
          `${this.contexts.size}/${this.maxContexts} slots in use`,
      );
    }
  }

  /** Save a context's cookies/localStorage to disk */
  private async saveSession(
    accountId: string,
    context: BrowserContext,
  ): Promise<void> {
    try {
      const sessionPath = path.join(this.sessionDir, `${accountId}.json`);
      const state = await context.storageState();
      fs.writeFileSync(sessionPath, JSON.stringify(state));
      this.logger.debug(`Session state saved for account ${accountId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to save session for account ${accountId}`,
        err,
      );
    }
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
