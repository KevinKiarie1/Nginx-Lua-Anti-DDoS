# ============================================================
# Dockerfile — CP-SOCIAL-BOT-FLEET-MODULAR
# ============================================================
# Multi-stage build optimized for Oracle Cloud A1 (ARM64).
# Stage 1: Build TypeScript + generate Prisma client
# Stage 2: Slim runtime with only production deps + Chromium
# ============================================================

# ── Stage 1: Builder ─────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN npm run build

# ── Stage 2: Runtime ─────────────────────────────────────────
FROM node:20-slim

ENV NODE_ENV=production

# Install dumb-init for proper PID 1 signal handling
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    # Playwright Chromium system dependencies
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libgtk-3-0 \
    libxshmfence1 fonts-liberation curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy Prisma schema + generated client from builder
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Install Playwright Chromium browser
RUN npx playwright install chromium

# Create session storage directory (mounted as volume in compose)
RUN mkdir -p /app/data/sessions

# Run as non-root for security
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--max-old-space-size=1536", "dist/main"]
