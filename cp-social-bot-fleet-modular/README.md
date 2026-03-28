# CP-Social-Bot-Fleet-Modular

A **production-ready, CP-consistent, multi-platform social media automation bot system** built as a **NestJS modular monolith**.

---

## Architecture Overview

### Modular Monolith

The system is a **single deployable process** with strict internal module boundaries:

```
┌──────────────────────────────────────────────────────────────┐
│                     AppModule (Composition Root)             │
├──────────────────────────────────────────────────────────────┤
│  ConfigModule │        CoreModule (Shared Infrastructure)    │
│               │  ┌─────────────────────────────────────────┐ │
│               │  │ PrismaDB │ Consistency │ TaskQueue      │ │
│               │  │ Scheduler│ Crypto      │ ProxyRotation  │ │
│               │  │ Browser  │ HumanBehavior│ RateLimiter   │ │
│               │  │ HandlerRegistry                         │ │
│               │  └─────────────────────────────────────────┘ │
├──────────┬──────────┬──────────┬──────────┬──────────────────┤
│ Telegram │ TikTok   │Instagram │ Facebook │   TasksModule    │
│ Module   │ Module   │ Module   │ Module   │  (Dispatcher +   │
│ (Telegraf│(Playwright│(Playwright│(Playwright│   REST API)    │
│  Bot API)│ Stealth) │ Stealth) │ Stealth) │                  │
├──────────┴──────────┴──────────┴──────────┴──────────────────┤
│                CockroachDB (SERIALIZABLE, Raft Consensus)    │
└──────────────────────────────────────────────────────────────┘
```

**Key rule:** Platform modules NEVER import each other. They communicate only through the shared task queue in CoreModule.

### CAP Theorem: CP (Consistency + Partition Tolerance)

This system **prioritizes Consistency (C) and Partition Tolerance (P)**, deliberately sacrificing Availability (A):

| Principle | Implementation |
|-----------|---------------|
| **Strong Consistency** | CockroachDB with SERIALIZABLE isolation (Raft consensus) |
| **Partition Tolerance** | Cluster health monitoring; operations rejected during partitions |
| **Availability Sacrifice** | Returns 503 during network partitions rather than stale data |
| **Task Atomicity** | SERIALIZABLE transactions prevent double-claiming |
| **Leader Election** | Single leader runs scheduler (prevents duplicate task creation) |
| **Idempotency** | Unique keys on tasks prevent duplicate creation |
| **DB-Backed Queue** | No Redis/BullMQ (AP systems); uses CockroachDB directly |
| **DB-Backed Rate Limits** | Shared across all instances via CockroachDB |

---

## Project Structure

```
src/
├── main.ts                          # Application entry point
├── app.module.ts                    # Composition root
├── config/
│   ├── config.module.ts             # Global config with validation
│   ├── app.config.ts                # Typed env var access
│   └── config.validation.ts         # Fail-fast env validation
├── core/                            # Shared infrastructure
│   ├── core.module.ts               # Aggregates all core services
│   ├── database/
│   │   ├── prisma.service.ts        # PrismaClient lifecycle
│   │   └── prisma.module.ts
│   ├── consistency/
│   │   ├── consistency.service.ts   # Cluster health, leader election
│   │   ├── consistency.guard.ts     # NestJS guard for CP enforcement
│   │   └── consistency.module.ts
│   ├── queue/
│   │   ├── task-queue.service.ts    # DB-backed CP task queue
│   │   └── queue.module.ts
│   ├── scheduler/
│   │   ├── scheduler.service.ts     # Leader-only cron evaluator
│   │   └── scheduler.module.ts
│   ├── crypto/
│   │   └── crypto.service.ts        # AES-256-GCM encryption
│   ├── proxy/
│   │   └── proxy.service.ts         # Sticky proxy rotation
│   ├── stealth/
│   │   ├── browser.service.ts       # Stealth Playwright launcher
│   │   └── human.service.ts         # Human behavior simulation
│   ├── rate-limiter/
│   │   └── rate-limiter.service.ts  # DB-backed rate limiting
│   └── registry/
│       └── handler-registry.service.ts  # Platform handler registry
├── common/                          # Shared DTOs, interfaces, utilities
│   ├── interfaces/
│   │   ├── platform-handler.interface.ts
│   │   └── task-result.interface.ts
│   ├── dto/
│   │   ├── create-task.dto.ts
│   │   ├── create-account.dto.ts
│   │   └── create-schedule.dto.ts
│   ├── exceptions/
│   │   └── partition.exception.ts   # PartitionException (503)
│   ├── decorators/
│   │   └── require-healthy.decorator.ts
│   ├── guards/
│   │   └── api-key.guard.ts
│   └── filters/
│       └── global-exception.filter.ts
├── tasks/                           # Task dispatch & API
│   ├── tasks.module.ts
│   ├── task-dispatcher.service.ts   # Polls queue, routes to handlers
│   ├── tasks.controller.ts          # POST /api/tasks, GET /api/health
│   └── schedules.controller.ts      # CRUD /api/schedules
└── modules/                         # Platform modules (independent)
    ├── telegram/
    │   ├── telegram.module.ts
    │   ├── telegram.handler.ts      # PlatformHandler (Telegraf.js)
    │   ├── telegram.service.ts      # Account management
    │   └── telegram.controller.ts   # REST API
    ├── tiktok/
    │   ├── tiktok.module.ts
    │   ├── tiktok.handler.ts        # PlatformHandler (Playwright)
    │   ├── tiktok.service.ts
    │   └── tiktok.controller.ts
    ├── instagram/
    │   ├── instagram.module.ts
    │   ├── instagram.handler.ts     # PlatformHandler (Playwright)
    │   ├── instagram.service.ts
    │   └── instagram.controller.ts
    └── facebook/
        ├── facebook.module.ts
        ├── facebook.handler.ts      # PlatformHandler (Playwright)
        ├── facebook.service.ts
        └── facebook.controller.ts
```

---

## Quick Start

### Prerequisites
- **Node.js** >= 20
- **Docker** & **Docker Compose**

### 1. Clone and configure

```bash
cd cp-social-bot-fleet-modular
cp .env.example .env

# Generate a secure encryption key:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Paste the result as ENCRYPTION_KEY in .env
```

### 2. Start with Docker Compose

```bash
# Start CockroachDB + the NestJS app
docker-compose up -d

# View logs
docker-compose logs -f app
```

### 3. Development mode (without Docker)

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Start CockroachDB (Docker)
docker run -d --name cockroach -p 26257:26257 -p 8080:8080 \
  cockroachdb/cockroach:v23.2.0 start-single-node --insecure

# Create the database
cockroach sql --insecure -e "CREATE DATABASE IF NOT EXISTS social_bot_fleet;"

# Push schema to DB
npx prisma db push

# Start in development mode
npm run start:dev
```

---

## API Reference

All endpoints require the `X-Api-Key` header (value from `.env` API_KEY).

### Health

```
GET /api/health
```

Returns cluster health, leader status, instance ID. Works even during partitions.

### Tasks

```
POST /api/tasks          — Create a new task
GET  /api/tasks/:id      — Get task by ID
GET  /api/queue/stats     — Queue statistics
```

**Create task example:**
```json
POST /api/tasks
{
  "type": "SEND_MESSAGE",
  "platform": "TELEGRAM",
  "payload": {
    "chatId": "123456",
    "text": "Hello from the bot fleet!"
  },
  "idempotencyKey": "msg-123-abc",
  "priority": 50
}
```

### Schedules

```
POST   /api/schedules     — Create a schedule
GET    /api/schedules      — List all schedules
GET    /api/schedules/:id  — Get schedule by ID
PUT    /api/schedules/:id  — Update a schedule
DELETE /api/schedules/:id  — Delete a schedule
```

**Create schedule example:**
```json
POST /api/schedules
{
  "name": "Daily TikTok Post",
  "cronExpr": "0 9 * * *",
  "platform": "TIKTOK",
  "taskType": "POST_CONTENT",
  "payload": {
    "caption": "Daily update!",
    "videoPath": "/path/to/video.mp4"
  },
  "accountId": "uuid-of-account"
}
```

### Platform Accounts

Each platform has its own account endpoints:

```
POST /api/telegram/accounts   — Create Telegram account
GET  /api/telegram/accounts   — List Telegram accounts
GET  /api/telegram/accounts/:id

POST /api/tiktok/accounts     — Create TikTok account
GET  /api/tiktok/accounts
GET  /api/tiktok/accounts/:id

POST /api/instagram/accounts  — Create Instagram account
GET  /api/instagram/accounts
GET  /api/instagram/accounts/:id

POST /api/facebook/accounts   — Create Facebook account
GET  /api/facebook/accounts
GET  /api/facebook/accounts/:id
```

**Create account example:**
```json
POST /api/tiktok/accounts
{
  "platform": "TIKTOK",
  "username": "mybot_tiktok",
  "credentials": {
    "username": "actual_tiktok_user",
    "password": "actual_password"
  },
  "metadata": { "proxy": "us-west" }
}
```

Credentials are **AES-256-GCM encrypted** before storage.

---

## Task Types

| Type | Platforms | Description |
|------|-----------|-------------|
| `SEND_MESSAGE` | Telegram | Send a message to a chat/group |
| `POST_CONTENT` | All | Post text/media content |
| `SEND_DM` | All | Send a direct message |
| `LIKE_POST` | TikTok, Instagram, Facebook | Like a post by URL |
| `COMMENT` | TikTok, Instagram, Facebook | Comment on a post |
| `FOLLOW_USER` | TikTok, Instagram | Follow a user profile |
| `UNFOLLOW_USER` | — | Defined in schema, currently rejected until implemented |
| `SCRAPE_USERS` | — | (Defined, not yet implemented) |
| `SCHEDULE_POST` | — | (Defined, not yet implemented) |

---

## Task Lifecycle

```
PENDING → CLAIMED → RUNNING → COMPLETED
                            → FAILED → PENDING (retry)
                            → DEAD_LETTER (max retries exceeded)
```

- **PENDING**: Task is in the queue, waiting to be claimed
- **CLAIMED**: A dispatcher instance claimed this task atomically and acquired a renewable lease
- **RUNNING**: Task execution is in progress and the worker renews its lease periodically
- **COMPLETED**: Task finished successfully
- **FAILED**: Task failed; if retries remain and the failure is retryable, it resets to PENDING
- **DEAD_LETTER**: Max retries exceeded; requires manual inspection

---

## Anti-Detection Features

For Playwright-based platforms (TikTok, Instagram, Facebook):

- **`navigator.webdriver` override** — Removes automation signal
- **Canvas fingerprint noise** — Tiny random alpha changes
- **WebGL fingerprint spoofing** — Fake GPU vendor/renderer
- **Plugin/language spoofing** — Realistic browser profile
- **Chrome runtime mock** — Prevents headless detection
- **Human-like behavior:**
  - Bezier curve mouse movements (not straight lines)
  - Variable-speed typing with random pauses
  - Off-center clicking (humans don't click dead center)
  - Variable-speed scrolling
  - Random "thinking" delays between actions
- **Per-account browser contexts** — Unique fingerprint per account
- **Sticky proxy rotation** — Each account always has the same proxy

---

## CP Design Decisions (Detailed)

### Why CockroachDB over PostgreSQL?
CockroachDB provides **SERIALIZABLE isolation by default** and uses **Raft consensus** for all writes. PostgreSQL can achieve similar guarantees but requires explicit `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` and advisory locks. CockroachDB makes CP the default, not an opt-in.

### Why DB-backed queue instead of Redis/BullMQ?
Redis is an **AP system** — it prioritizes Availability over Consistency. In a Redis cluster with partitions, the same task could be delivered to multiple workers. Our DB-backed queue uses SERIALIZABLE transactions, so task claiming is **guaranteed atomic**.

### Why leader-only scheduling?
Without leader election, every instance of the monolith would evaluate the same schedules and create duplicate tasks. The leader now holds a **leased scheduler lock** that must be renewed continuously, which prevents stale leaders from continuing to schedule after losing ownership.

### What happens during a partition?
1. The `ConsistencyService` detects unhealthy cluster (heartbeat failures)
2. `ClusterHealth` transitions to `PARTITIONED`
3. All task creation, claiming, and processing is **rejected** (503 Service Unavailable)
4. The `ConsistencyGuard` blocks HTTP requests decorated with `@RequireHealthy()`
5. The system **waits** until quorum is restored
6. The API health endpoint (`GET /api/health`) still works (not guarded)

### DB-backed rate limiting
Rate limit events are stored in CockroachDB, not in-memory. This means all instances share the same rate-limit counters — preventing one instance from exceeding platform limits while another is unaware.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | CockroachDB/PostgreSQL connection string |
| `ENCRYPTION_KEY` | Yes | — | AES encryption key (≥32 chars) |
| `PORT` | No | 3000 | HTTP server port |
| `API_KEY` | No | — | API key for auth (empty = no auth) |
| `INSTANCE_ID` | No | `node-{pid}` | Unique instance identifier |
| `WORKER_PLATFORMS` | No | All | Comma-separated platforms to handle |
| `WORKER_POLL_INTERVAL_MS` | No | 2000 | Task poll interval |
| `WORKER_MAX_CONCURRENT_TASKS` | No | 5 | Max concurrent task executions |
| `WORKER_LEASE_DURATION_MS` | No | 300000 | Task lease duration before a worker claim expires |
| `WORKER_LEASE_RENEW_INTERVAL_MS` | No | 30000 | Lease renewal interval for active tasks |
| `WORKER_TASK_TIMEOUT_MS` | No | 300000 | Hard timeout for a single task execution |
| `CLUSTER_HEARTBEAT_INTERVAL_MS` | No | 5000 | Heartbeat interval |
| `CLUSTER_LEADER_LEASE_MS` | No | 15000 | Scheduler leader lock duration |
| `CLUSTER_NODE_TIMEOUT_MS` | No | 15000 | Node timeout threshold |
| `CLUSTER_MIN_NODES` | No | 1 | Minimum nodes for quorum |
| `STALE_TASK_TIMEOUT_MS` | No | 300000 | Legacy fallback for task lease duration |
| `RATE_LIMIT_TELEGRAM` | No | 20 | Telegram actions/minute |
| `RATE_LIMIT_TIKTOK` | No | 5 | TikTok actions/minute |
| `RATE_LIMIT_INSTAGRAM` | No | 5 | Instagram actions/minute |
| `RATE_LIMIT_FACEBOOK` | No | 10 | Facebook actions/minute |
| `PROXY_LIST` | No | — | Comma-separated proxy URLs |
| `TELEGRAM_BOT_TOKEN` | No | — | Global Telegram bot token |
| `BROWSER_HEADLESS` | No | true | Run Playwright headless |
| `BROWSER_SLOW_MO` | No | 50 | Playwright slow-motion ms |

---

## Adding a New Platform

1. Create `src/modules/newplatform/`
2. Implement `PlatformHandler` interface in a `newplatform.handler.ts`
3. Register the handler in `onModuleInit()` via `HandlerRegistryService`
4. Add `NewPlatformModule` to `AppModule` imports
5. Add the platform enum to `prisma/schema.prisma`

The modular architecture means zero changes to existing platform modules.

---

## License

MIT
