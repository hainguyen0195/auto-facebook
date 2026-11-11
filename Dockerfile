FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run desktop:bundle
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build BETTER_AUTH_SECRET=build-only-placeholder-never-used-at-runtime-123456789 BETTER_AUTH_URL=http://localhost:3000 npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && groupadd --gid 1001 nhipdang && useradd --uid 1001 --gid nhipdang --create-home nhipdang
COPY --from=builder --chown=nhipdang:nhipdang /app/.next/standalone ./
COPY --from=builder --chown=nhipdang:nhipdang /app/.next/static ./.next/static
COPY --from=builder --chown=nhipdang:nhipdang /app/public ./public
COPY --from=builder --chown=nhipdang:nhipdang /app/node_modules ./node_modules
COPY --from=builder --chown=nhipdang:nhipdang /app/prisma ./prisma
COPY --from=builder --chown=nhipdang:nhipdang /app/prisma.config.ts /app/tsconfig.json /app/package.json ./
COPY --from=builder --chown=nhipdang:nhipdang /app/src ./src
COPY --from=builder --chown=nhipdang:nhipdang /app/scripts/create-user.ts ./scripts/create-user.ts
RUN mkdir -p /app/.data/media && chown -R nhipdang:nhipdang /app/.data
USER nhipdang
EXPOSE 3000
CMD ["node", "server.js"]
