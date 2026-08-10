# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Optional sub-path (e.g. "/morgana") for serving behind a reverse proxy.
# Next bakes basePath during `next build`, so this MUST be a build-time input —
# setting it on the runner has no effect. Empty default = serve at the root.
# Kept immediately before the build step (not above the COPYs) so toggling it
# only busts the build layer's cache, not the deps/source layers above.
ARG MORGANA_BASE_PATH=""
ENV MORGANA_BASE_PATH=$MORGANA_BASE_PATH
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Next's standalone server.js does `process.env.HOSTNAME || '0.0.0.0'`, and
# Docker injects HOSTNAME=<container-id> into every container — so without this
# the server binds ONLY to the container's eth0 address. Published ports still
# work (they DNAT to that address, which is why the smoke test cannot see this),
# but `localhost` inside the container is dead: `docker exec … curl localhost:3000`
# and any HEALTHCHECK against loopback get connection-refused. This is what
# Next's own official Docker example sets, for the same reason.
ENV HOSTNAME=0.0.0.0
RUN mkdir -p /data/decks
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Bundled sample for first-run auto-seed (see docker-entrypoint.sh).
COPY samples/ ./samples/
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
