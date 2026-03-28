# ============================================================
# Dockerfile — CP-SOCIAL-BOT-FLEET-MODULAR
# ============================================================
# Multi-stage build: install deps, generate Prisma, build TS,
# install Playwright Chromium, then run the compiled monolith.
# ============================================================

FROM node:20-slim

# Playwright system dependencies
RUN apt-get update && apt-get install -y \
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libgtk-3-0 \
    libxshmfence1 fonts-liberation curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --ignore-scripts

# Generate Prisma client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source and build
COPY . .
RUN npm run build

# Install Playwright Chromium browser
RUN npx playwright install chromium

EXPOSE 3000

CMD ["node", "dist/main"]
