FROM mcr.microsoft.com/playwright:v1.56.0-noble
ENV DEBIAN_FRONTEND=noninteractive PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 HOST=0.0.0.0 PORT=8088 DATA_DIR=/data DISPLAY=:99 PULSE_SERVER=unix:/tmp/pulse.sock
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg pulseaudio fluxbox x11-utils tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json browser-entry.ts ./
COPY src ./src
COPY vendor ./vendor
COPY public ./public
COPY deploy ./deploy
RUN npm run build && npm prune --omit=dev && mkdir -p /data && chmod +x deploy/entrypoint.sh
EXPOSE 8088
ENTRYPOINT ["/usr/bin/tini","--","/app/deploy/entrypoint.sh"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8088/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
