# syntax=docker/dockerfile:1
#
# k7 — the rehearsal recorder, ONE process. This backend serves its own built
# frontend directly (express.static + an SPA fallback, apps/k7/backend/src/server.ts)
# — there is no nginx in this image, unlike the shared `frediverse-base` image
# (commons/dev/docker-runtime), which this image deliberately does NOT start from.
#
# Build from the repo root: docker build -f apps/k7/docker/Dockerfile .

# ---- prune: cut the monorepo down to what this app needs -------------------
FROM node:22-alpine AS pruner
WORKDIR /repo
RUN npm install -g turbo@2
COPY . .
RUN turbo prune k7-frontend k7-backend --docker
# A SECOND prune, backend-only, is what the runtime stage ships — see
# apps/st0/Dockerfile's comment for why this matters here.
RUN turbo prune k7-backend --docker --out-dir=out-backend

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
RUN npm run build --workspace k7-frontend

# ---- backend prod deps -------------------------------------------------------
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY --from=pruner /repo/out-backend/json/ ./
RUN apk add --no-cache python3 make g++ \
 && npm ci \
 && npm prune --omit=dev

# ---- final image --------------------------------------------------------------
FROM node:22-alpine AS runtime
# ffmpeg: decodes a take's envelope and mixes the instrumental — apps/k7/docs/audio.md.
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=pruner /repo/out-backend/full/ ./
# The built SPA — apps/k7/backend/src/server.ts serves this directly.
COPY --from=frontend-build /app/apps/k7/frontend/dist ./apps/k7/frontend/dist

# k7's sessions and takes.
VOLUME ["/app/apps/k7/backend/data"]

ENV PORT=8787
EXPOSE 8787
WORKDIR /app/apps/k7/backend
CMD ["node", "--experimental-strip-types", "src/server.ts"]
