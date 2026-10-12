# syntax=docker/dockerfile:1
#
# st0 — the web editor, the media library and the rehearsal recorder, ONE process: the backend serves its own built
# frontend, no nginx, and this image deliberately does NOT start from `frediverse-base` (commons/dev/docker-runtime).
#
# The first three stages are byte-identical in the two studio Dockerfiles, so the installs are
# built once per lockfile and shared by both — docs/images.md. Keep them identical.
#
# Build from the repo root: docker build -f apps/st0/docker/Dockerfile .

# ---- manifests: the lockfile and every package.json, nothing else -----------
FROM node:22-alpine AS manifests
WORKDIR /src
COPY . .
RUN mkdir /out && { find . -name package.json -not -path '*/node_modules/*'; echo ./package-lock.json; echo ./.npmrc; } | tar -cf - -T - | tar -xf - -C /out

# ---- toolchain: ssh2 (st0's media sftp) builds its optional crypto binding
FROM node:22-alpine AS toolchain
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
RUN npm exec --workspace st0-frontend -- vite build

# ---- backend prod deps: st0-backend's closure only, no devDependencies -------
FROM toolchain AS backend-deps
RUN --mount=type=cache,target=/root/.npm npm ci --workspace st0-backend --omit=dev --no-audit --no-fund

# ---- final image --------------------------------------------------------------
FROM node:22-alpine AS runtime
# yt-dlp/ffmpeg: media imports and a take's envelope and instrumental; mpv: packages/mpv-player/docs/mpvPlayer.md.
RUN apk add --no-cache yt-dlp ffmpeg mpv
WORKDIR /app
COPY --from=backend-deps /app ./
# The whole repo: @studio/* are symlinks to raw TypeScript source, so a missing package is a crash on import.
COPY . .
# The built SPA — apps/st0/backend/src/server.ts serves this directly.
COPY --from=frontend-build /app/apps/st0/frontend/dist ./apps/st0/frontend/dist

# st0's per-person preferences (packages/user-prefs/docs/store.md).
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
# `node:sqlite` (the shares' comments store) is still behind this flag on Node 22; a no-op on 24+.
ENV NODE_OPTIONS=--experimental-sqlite
EXPOSE 8789
WORKDIR /app/apps/st0/backend
# tsx to import the brain's TS source directly — see src/server.ts's own header.
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]
