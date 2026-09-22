# syntax=docker/dockerfile:1
#
# pl8 — the médiathèque, ONE process. This backend serves its own built frontend
# directly (express.static + an SPA fallback, apps/pl8/backend/src/server.ts) —
# there is no nginx in this image, unlike the shared `frediverse-base` image
# (commons/dev/docker-runtime), which this image deliberately does NOT start from.
#
# Build from the repo root: docker build -f apps/pl8/docker/Dockerfile .

# ---- prune: cut the monorepo down to what this app needs -------------------
FROM node:22-alpine AS pruner
WORKDIR /repo
RUN npm install -g turbo@2
COPY . .
RUN turbo prune pl8-frontend pl8-backend --docker
# A SECOND prune, backend-only, is what the runtime stage ships — see
# apps/st0/Dockerfile's comment for why this matters here.
RUN turbo prune pl8-backend --docker --out-dir=out-backend

# ---- deps: install from the pruned lockfile --------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
# node-pty (a root devDependency, pulled in even though this app doesn't use it) has no musl
# prebuild and falls back to node-gyp, which alpine ships neither python3 nor a C toolchain for.
RUN apk add --no-cache python3 make g++ \
 && npm ci

# ---- frontend build ----------------------------------------------------------
FROM deps AS frontend-build
WORKDIR /app
COPY --from=pruner /repo/out/full/ ./
COPY scripts ./scripts
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace pl8-frontend

# ---- backend prod deps -------------------------------------------------------
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY --from=pruner /repo/out-backend/json/ ./
RUN apk add --no-cache python3 make g++ \
 && npm ci \
 && npm prune --omit=dev

# ---- final image --------------------------------------------------------------
FROM node:22-alpine AS runtime
# yt-dlp, ffmpeg: the médiathèque's imports/transcodes/analysis. mpv: pl8 plays on this
# host's own outputs (packages/mpv-player/docs/mpvPlayer.md) — without it that one route
# answers 503 and nothing else notices.
RUN apk add --no-cache yt-dlp ffmpeg mpv
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=pruner /repo/out-backend/full/ ./
# The built SPA — apps/pl8/backend/src/server.ts serves this directly.
COPY --from=frontend-build /app/apps/pl8/frontend/dist ./apps/pl8/frontend/dist

# pl8 IS this volume (apps/pl8/docs/config.md).
ENV STUDIO_MEDIATEK=/library
VOLUME ["/library"]

ENV PORT=8795
# `node:sqlite` (the shares' comments store) is still behind this flag on Node 22 — the
# image's runtime. Accepted as a no-op on 24+, so the bump costs nothing to prepare for.
ENV NODE_OPTIONS=--experimental-sqlite
EXPOSE 8795
WORKDIR /app/apps/pl8/backend
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]
