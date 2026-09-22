# syntax=docker/dockerfile:1
#
# st0 — the web editor, ONE process. This backend serves its own built frontend
# directly (express.static + an SPA fallback, apps/st0/backend/src/server.ts) —
# there is no nginx in this image and nothing else to supervise, unlike the
# shared `frediverse-base` image (commons/dev/docker-runtime), which this image
# deliberately does NOT start from.
#
# Build from the repo root: docker build -f apps/st0/docker/Dockerfile .

# ---- deps: install this app's own workspace dependencies --------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY . .
# node-pty (a root devDependency, pulled in even though this app doesn't use it) has no musl
# prebuild and falls back to node-gyp, which alpine ships neither python3 nor a C toolchain for.
RUN apk add --no-cache python3 make g++ \
 && npm ci --workspace st0-frontend --workspace st0-backend --include-workspace-root

# ---- frontend build ----------------------------------------------------------
FROM deps AS frontend-build
# The build stamp shown in the SPA's chrome — docs/versioning.md.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace st0-frontend

# ---- backend prod deps -------------------------------------------------------
# A SEPARATE install, scoped to just st0-backend and its @studio/* dependency closure, is
# what the runtime stage ships: no frontend-only deps, no devDependencies. node_modules/@studio/*
# are symlinks into the workspace, so a package missing from the image is a dangling link and a
# crash on first import — these packages are consumed as raw TYPESCRIPT SOURCE rather than as
# build output, which is why the runtime stage below copies the whole repo rather than just
# node_modules.
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY . .
RUN apk add --no-cache python3 make g++ \
 && npm ci --workspace st0-backend --omit=dev

# ---- final image --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=backend-deps /app ./
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
