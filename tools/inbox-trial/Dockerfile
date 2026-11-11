FROM node:24-bookworm-slim
ENV NODE_ENV=production DISPLAY=:99 HOME=/home/inbox XDG_CONFIG_HOME=/data/chromium-config XDG_CACHE_HOME=/data/cache
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb x11vnc novnc websockify x11-utils util-linux fonts-noto-core ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1101 inbox && useradd --uid 1101 --gid inbox --create-home inbox
WORKDIR /app
COPY tools/inbox-trial/package*.json ./
RUN npm ci --omit=dev
COPY src/inbox-trial ./src/inbox-trial
COPY scripts/inbox-trial.ts ./scripts/inbox-trial.ts
COPY tools/inbox-trial ./tools/inbox-trial
RUN chmod +x tools/inbox-trial/start.sh
USER inbox
EXPOSE 6080 8787
CMD ["bash", "/app/tools/inbox-trial/start.sh"]
