# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# This non-secret placeholder is build-only. Generation never connects to a DB.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate

# Explicit operator-only target; never runs as part of application startup.
FROM dependencies AS migration
ENV NODE_ENV=production
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production PORT=5000 FIXIT_CONTAINER=true
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
