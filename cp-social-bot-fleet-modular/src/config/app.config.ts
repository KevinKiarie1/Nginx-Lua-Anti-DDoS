// ============================================================
// APPLICATION CONFIGURATION
// ============================================================
// Validates and exposes all environment variables as typed config.
// Uses @nestjs/config registerAs() for namespaced, type-safe access.
//
// Usage in services:
//   constructor(private config: ConfigService) {}
//   const port = this.config.get<number>('app.port');
// ============================================================

import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  // Server
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiKey: process.env.API_KEY ?? '',
  instanceId: process.env.INSTANCE_ID ?? `node-${process.pid}`,
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',

  // Worker
  workerPlatforms:
    process.env.WORKER_PLATFORMS ?? 'TELEGRAM,TIKTOK,INSTAGRAM,FACEBOOK',
  workerPollIntervalMs: parseInt(
    process.env.WORKER_POLL_INTERVAL_MS ?? '2000',
    10,
  ),
  workerMaxConcurrentTasks: parseInt(
    process.env.WORKER_MAX_CONCURRENT_TASKS ?? '5',
    10,
  ),
  workerLeaseDurationMs: parseInt(
    process.env.WORKER_LEASE_DURATION_MS ??
      process.env.STALE_TASK_TIMEOUT_MS ??
      '300000',
    10,
  ),
  workerLeaseRenewIntervalMs: parseInt(
    process.env.WORKER_LEASE_RENEW_INTERVAL_MS ?? '30000',
    10,
  ),
  workerTaskTimeoutMs: parseInt(
    process.env.WORKER_TASK_TIMEOUT_MS ?? '300000',
    10,
  ),

  // Cluster / CP consistency
  clusterHeartbeatIntervalMs: parseInt(
    process.env.CLUSTER_HEARTBEAT_INTERVAL_MS ?? '5000',
    10,
  ),
  clusterNodeTimeoutMs: parseInt(
    process.env.CLUSTER_NODE_TIMEOUT_MS ?? '15000',
    10,
  ),
  clusterLeaderLeaseMs: parseInt(
    process.env.CLUSTER_LEADER_LEASE_MS ??
      process.env.CLUSTER_NODE_TIMEOUT_MS ??
      '15000',
    10,
  ),
  clusterMinNodes: parseInt(process.env.CLUSTER_MIN_NODES ?? '1', 10),
  staleTaskTimeoutMs: parseInt(
    process.env.STALE_TASK_TIMEOUT_MS ?? '300000',
    10,
  ),

  // Rate limits (per platform, per minute)
  rateLimitTelegram: parseInt(process.env.RATE_LIMIT_TELEGRAM ?? '20', 10),
  rateLimitTiktok: parseInt(process.env.RATE_LIMIT_TIKTOK ?? '5', 10),
  rateLimitInstagram: parseInt(process.env.RATE_LIMIT_INSTAGRAM ?? '5', 10),
  rateLimitFacebook: parseInt(process.env.RATE_LIMIT_FACEBOOK ?? '10', 10),

  // Proxy pool
  proxyList: (process.env.PROXY_LIST ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean),

  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',

  // Browser automation
  browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
  browserSlowMo: parseInt(process.env.BROWSER_SLOW_MO ?? '50', 10),
}));
