# syntax=docker/dockerfile:1
#
# k7 — the web editor, the media library and the rehearsal recorder, ONE process: the backend serves its own built
# frontend, no nginx, and this image deliberately does NOT start from `frediverse-base` (commons/dev/docker-runtime).
#
# The first three stages see only the manifests, so the installs are cached across every push that
# leaves them alone — docs/images.md. Node is 24, the one version production and CI share (same page).
#
# Build from the repo root: docker build -f apps/k7/docker/Dockerfile .

# ---- manifests: the lockfile and every package.json, nothing else -----------
FROM node:24-alpine AS manifests
WORKDIR /src
COPY . .
RUN mkdir /out && { find . -name package.json -not -path '*/node_modules/*'; echo ./package-lock.json; echo ./.npmrc; } | tar -cf - -T - | tar -xf - -C /out

# ---- toolchain: ssh2 (k7's media sftp) builds its optional crypto binding
FROM node:24-alpine AS toolchain
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY --from=manifests /out ./

# ---- deps: the whole workspace, which every frontend build starts from ------
FROM toolchain AS deps
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- frontend build ----------------------------------------------------------
FROM deps AS frontend-build
COPY . .
# The build stamp shown in the SPA's chrome — docs/versioning.md.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
# vite alone: the lint job typechecks every workspace (docs/images.md).
RUN npm exec --workspace k7-frontend -- vite build
# The backend and the file service as plain JS, reading the checkout around them: no tsx at run time (docs/images.md).
RUN node apps/k7/backend/scripts/bundle.mjs server-dist --in-tree

# ---- backend prod deps: k7-backend's closure only, no devDependencies -------
FROM toolchain AS backend-deps
RUN --mount=type=cache,target=/root/.npm npm ci --workspace k7-backend --omit=dev --no-audit --no-fund

# ---- final image --------------------------------------------------------------
FROM node:24-alpine AS runtime
# yt-dlp/ffmpeg: media imports and a take's envelope and instrumental; mpv: packages/mpv-player/docs/mpvPlayer.md.
RUN apk add --no-cache yt-dlp ffmpeg mpv
# chromium and its fonts: `picture render`, the picture drawn headless (packages/file-service/docs/serverRender.md).
RUN apk add --no-cache chromium font-noto ttf-freefont
ENV STUDIO_CHROMIUM=/usr/bin/chromium-browser
# Before the VOLUME lines, which freeze them: a fresh volume copies this owner (docs/images.md).
RUN mkdir -p /data /library /workspaces /rehearsal-data \
 && chown node:node /data /library /workspaces /rehearsal-data
# Express hides its stack traces and the rehearsal server refuses the dev secret.
ENV NODE_ENV=production
WORKDIR /app
COPY --from=backend-deps /app ./
# The whole repo: @studio/* are symlinks to raw TypeScript source, so a missing package is a crash on import.
COPY . .
# The built SPA — apps/k7/backend/src/server.ts serves this directly.
COPY --from=frontend-build /app/apps/k7/frontend/dist ./apps/k7/frontend/dist
COPY --from=frontend-build /app/server-dist ./server-dist
# Each account's file service is started from the bundle too, not from source under tsx.
ENV STUDIO_FILE_SERVICE_ENTRY=/app/server-dist/file-service.mjs

# k7's per-person preferences (packages/user-prefs/docs/store.md).
ENV STUDIO_PREFS_DIR=/data/prefs
VOLUME ["/data"]
# The media library IS this volume.
ENV STUDIO_MEDIATEK=/library
VOLUME ["/library"]
# The accounts' workspaces, one folder each, when the deployment sets $STUDIO_FILES_ROOT to it.
VOLUME ["/workspaces"]
# The rehearsal recorder's audio cache and uploads in flight (packages/rehearsal-server/src/env.ts).
ENV K7_DATA_DIR=/rehearsal-data
VOLUME ["/rehearsal-data"]

ENV PORT=8789
EXPOSE 8789
WORKDIR /app/apps/k7/backend
# Not root: the code under /app is root's and read-only to it; only the volumes above are its own.
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8789/api/health || exit 1
# The bundle, under plain node: no transpiler and no esbuild child per process (docs/images.md).
CMD ["node", "/app/server-dist/backend.mjs"]
