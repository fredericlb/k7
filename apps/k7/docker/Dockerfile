# syntax=docker/dockerfile:1
#
# k7 — the rehearsal recorder, ONE process. This backend serves its own built
# frontend directly (express.static + an SPA fallback, apps/k7/backend/src/server.ts)
# — there is no nginx in this image, unlike the shared `frediverse-base` image
# (commons/dev/docker-runtime), which this image deliberately does NOT start from.
#
# Build from the repo root: docker build -f apps/k7/docker/Dockerfile .

# ---- deps: install this app's own workspace dependencies --------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY . .
# node-pty (a root devDependency, pulled in even though this app doesn't use it) has no musl
# prebuild and falls back to node-gyp, which alpine ships neither python3 nor a C toolchain for.
RUN apk add --no-cache python3 make g++ \
 && npm ci --workspace k7-frontend --workspace k7-backend --include-workspace-root

# ---- frontend build ----------------------------------------------------------
FROM deps AS frontend-build
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace k7-frontend

# ---- backend prod deps -------------------------------------------------------
# A SEPARATE install, scoped to just k7-backend and its @studio/* dependency closure, is
# what the runtime stage ships — see apps/st0/docker/Dockerfile's comment for why this
# matters here.
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY . .
RUN apk add --no-cache python3 make g++ \
 && npm ci --workspace k7-backend --omit=dev

# ---- final image --------------------------------------------------------------
FROM node:22-alpine AS runtime
# ffmpeg: decodes a take's envelope and mixes the instrumental — apps/k7/docs/audio.md.
RUN apk add --no-cache ffmpeg
WORKDIR /app
# The whole repo, but with node_modules pruned to k7-backend's own runtime dependency
# closure only — no frontend-only deps, no devDependencies.
COPY --from=backend-deps /app ./
# The built SPA — apps/k7/backend/src/server.ts serves this directly.
COPY --from=frontend-build /app/apps/k7/frontend/dist ./apps/k7/frontend/dist

# k7's sessions and takes.
VOLUME ["/app/apps/k7/backend/data"]

ENV PORT=8787
# What lets the backend refuse the development secret (backend/src/env.ts); Express also stops printing stacks.
ENV NODE_ENV=production
EXPOSE 8787
WORKDIR /app/apps/k7/backend
CMD ["node", "--experimental-strip-types", "src/server.ts"]
