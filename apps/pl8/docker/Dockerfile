# syntax=docker/dockerfile:1
#
# pl8 — the médiathèque, ONE process. This backend serves its own built frontend
# directly (express.static + an SPA fallback, apps/pl8/backend/src/server.ts) —
# there is no nginx in this image, unlike the shared `frediverse-base` image
# (commons/dev/docker-runtime), which this image deliberately does NOT start from.
#
# Build from the repo root: docker build -f apps/pl8/docker/Dockerfile .

# ---- deps: install this app's own workspace dependencies --------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY . .
# node-pty (a root devDependency, pulled in even though this app doesn't use it) has no musl
# prebuild and falls back to node-gyp, which alpine ships neither python3 nor a C toolchain for.
RUN apk add --no-cache python3 make g++ \
 && npm ci --workspace pl8-frontend --workspace pl8-backend --include-workspace-root

# ---- frontend build ----------------------------------------------------------
FROM deps AS frontend-build
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace pl8-frontend

# ---- backend prod deps -------------------------------------------------------
# A SEPARATE install, scoped to just pl8-backend and its @studio/* dependency closure, is
# what the runtime stage ships — see apps/st0/docker/Dockerfile's comment for why this
# matters here.
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY . .
RUN apk add --no-cache python3 make g++ \
 && npm ci --workspace pl8-backend --omit=dev

# ---- final image --------------------------------------------------------------
FROM node:22-alpine AS runtime
# yt-dlp, ffmpeg: the médiathèque's imports/transcodes/analysis. mpv: pl8 plays on this
# host's own outputs (packages/mpv-player/docs/mpvPlayer.md) — without it that one route
# answers 503 and nothing else notices. git, git-lfs, openssh: the hosted file services clone,
# commit and push the accounts' workspaces (packages/file-hub/docs/fileHub.md), and refuse to
# clone a repository whose media is in LFS without git-lfs.
RUN apk add --no-cache yt-dlp ffmpeg mpv git git-lfs openssh-client
WORKDIR /app
# The whole repo, but with node_modules pruned to pl8-backend's own runtime dependency
# closure only — no frontend-only deps, no devDependencies.
COPY --from=backend-deps /app ./
# The built SPA — apps/pl8/backend/src/server.ts serves this directly.
COPY --from=frontend-build /app/apps/pl8/frontend/dist ./apps/pl8/frontend/dist

# pl8 IS this volume (apps/pl8/docs/config.md).
ENV STUDIO_MEDIATEK=/library
VOLUME ["/library"]
# The accounts' workspaces, one folder each, when the deployment sets $STUDIO_FILES_ROOT to it.
VOLUME ["/workspaces"]

ENV PORT=8795
# `node:sqlite` (the shares' comments store) is still behind this flag on Node 22 — the
# image's runtime. Accepted as a no-op on 24+, so the bump costs nothing to prepare for.
ENV NODE_OPTIONS=--experimental-sqlite
EXPOSE 8795
WORKDIR /app/apps/pl8/backend
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]
