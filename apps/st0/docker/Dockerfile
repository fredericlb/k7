# syntax=docker/dockerfile:1
#
# st0 — the web editor, ONE process. This backend serves its own built frontend
# directly (express.static + an SPA fallback, apps/st0/backend/src/server.ts) —
# there is no nginx in this image and nothing else to supervise, unlike the
# shared `frediverse-base` image (commons/dev/docker-runtime), which this image
# deliberately does NOT start from.
#
# Build from the repo root: docker build -f apps/st0/docker/Dockerfile .

# ---- prune: cut the monorepo down to what this app needs -------------------
FROM node:22-alpine AS pruner
WORKDIR /repo
RUN npm install -g turbo@2
COPY . .
RUN turbo prune st0-frontend st0-backend --docker
# A SECOND prune, backend-only, is what the runtime stage ships: no frontend
# source, no frontend-only deps. node_modules/@studio/* are symlinks into the
# workspace, so a package missing from the image is a dangling link and a
# crash on first import — these packages are consumed as raw TYPESCRIPT
# SOURCE rather than as build output.
RUN turbo prune st0-backend --docker --out-dir=out-backend

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
# The vite configs import the repo-root scripts/dev-hosts.mjs, which turbo prune
# does not carry (it only keeps workspace directories).
COPY scripts ./scripts
# The build stamp shown in the SPA's chrome — docs/versioning.md.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace st0-frontend

# ---- backend prod deps -------------------------------------------------------
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY --from=pruner /repo/out-backend/json/ ./
RUN apk add --no-cache python3 make g++ \
 && npm ci \
 && npm prune --omit=dev

# ---- final image --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=pruner /repo/out-backend/full/ ./
# The built SPA — apps/st0/backend/src/server.ts serves this directly.
COPY --from=frontend-build /app/apps/st0/frontend/dist ./apps/st0/frontend/dist

# st0's per-person preferences (packages/user-prefs/docs/store.md).
ENV STUDIO_PREFS_DIR=/data/prefs
VOLUME ["/data"]

ENV PORT=8789
EXPOSE 8789
WORKDIR /app/apps/st0/backend
# tsx to import the brain's TS source directly — see src/server.ts's own header.
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]
