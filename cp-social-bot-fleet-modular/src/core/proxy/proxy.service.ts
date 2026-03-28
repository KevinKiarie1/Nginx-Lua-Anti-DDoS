// ============================================================
// PROXY SERVICE — Proxy Pool & Rotation
// ============================================================
// Manages a pool of proxies and rotates them per-account to
// avoid IP-based detection and rate limiting.
//
// Proxy assignment is "sticky" per account — each account is
// always assigned the same proxy to maintain session cookies
// and avoid re-detection on every request.
// ============================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

@Injectable()
export class ProxyService implements OnModuleInit {
  private readonly logger = new Logger(ProxyService.name);
  private proxies: ProxyConfig[] = [];
  private currentIndex = 0;

  /** Map of accountId → assigned proxy (sticky assignment) */
  private accountProxyMap = new Map<string, ProxyConfig>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const proxyList = this.config.get<string[]>('app.proxyList') ?? [];
    this.proxies = proxyList
      .map((p) => this.parseProxy(p))
      .filter(Boolean) as ProxyConfig[];
    this.logger.log(`Proxy pool initialized: ${this.proxies.length} proxies`);
  }

  private parseProxy(proxyStr: string): ProxyConfig | null {
    try {
      const url = new URL(proxyStr);
      return {
        server: `${url.protocol}//${url.hostname}:${url.port}`,
        username: url.username || undefined,
        password: url.password || undefined,
      };
    } catch {
      this.logger.warn(`Invalid proxy URL: ${proxyStr}`);
      return null;
    }
  }

  /** Get next proxy from pool (round-robin) */
  getNextProxy(): ProxyConfig | null {
    if (this.proxies.length === 0) return null;
    const proxy = this.proxies[this.currentIndex % this.proxies.length];
    this.currentIndex++;
    return proxy;
  }

  /** Get or assign a sticky proxy for a specific account */
  getProxyForAccount(accountId: string): ProxyConfig | null {
    if (this.proxies.length === 0) return null;
    let proxy = this.accountProxyMap.get(accountId);
    if (!proxy) {
      proxy = this.getNextProxy()!;
      this.accountProxyMap.set(accountId, proxy);
    }
    return proxy;
  }

  /** Check if any proxies are configured */
  hasProxies(): boolean {
    return this.proxies.length > 0;
  }
}
