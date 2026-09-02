# Single-stage on purpose. A multi-stage build would shave maybe 150MB, but it
# also means the Pi cannot rebuild in place after an edit, and being able to
# change one file and restart is worth more than the disk on a box that exists
# to run one service.
FROM node:22-bookworm-slim

# iputils-ping is required: the collector shells out to the system ping rather
# than opening raw sockets, which would need root or CAP_NET_RAW.
# iproute2 provides `ip neigh` for the ARP-based presence detection.
RUN apt-get update \
    && apt-get install -y --no-install-recommends iputils-ping iproute2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8477
ENV DB_FILE=/data/waifai.sqlite

VOLUME ["/data"]
EXPOSE 8477

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
