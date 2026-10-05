# syntax=docker/dockerfile:1
#
# pl8 — the médiathèque, ONE process: the backend serves its own built frontend, no nginx, and
# this image deliberately does NOT start from `frediverse-base` (commons/dev/docker-runtime).
#
# The first three stages are byte-identical in the four studio Dockerfiles, so the installs are
# built once per lockfile and shared by all four — docs/images.md. Keep them identical.
#
# Build from the repo root: docker build -f apps/pl8/docker/Dockerfile .

# ---- manifests: the lockfile and every package.json, nothing else -----------
FROM node:22-alpine AS manifests
WORKDIR /src
COPY . .
RUN mkdir /out && { find . -name package.json -not -path '*/node_modules/*'; echo ./package-lock.json; echo ./.npmrc; } | tar -cf - -T - | tar -xf - -C /out

# ---- toolchain: ssh2 (pl8's sftp) builds its optional crypto binding with it
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
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace pl8-frontend

# ---- backend prod deps: pl8-backend's closure only, no devDependencies -------
FROM toolchain AS backend-deps
RUN --mount=type=cache,target=/root/.npm npm ci --workspace pl8-backend --omit=dev --no-audit --no-fund

# ---- final image --------------------------------------------------------------
FROM node:22-alpine AS runtime
# yt-dlp/ffmpeg: imports; mpv: packages/mpv-player/docs/mpvPlayer.md; git/git-lfs/ssh: packages/file-hub/docs/fileHub.md.
RUN apk add --no-cache yt-dlp ffmpeg mpv git git-lfs openssh-client
WORKDIR /app
COPY --from=backend-deps /app ./
# The whole repo: @studio/* are symlinks to raw TypeScript source, so a missing package is a crash on import.
COPY . .
# The built SPA — apps/pl8/backend/src/server.ts serves this directly.
COPY --from=frontend-build /app/apps/pl8/frontend/dist ./apps/pl8/frontend/dist

# pl8 IS this volume (apps/pl8/docs/config.md).
ENV STUDIO_MEDIATEK=/library
VOLUME ["/library"]
# The accounts' workspaces, one folder each, when the deployment sets $STUDIO_FILES_ROOT to it.
VOLUME ["/workspaces"]

ENV PORT=8795
# `node:sqlite` (the shares' comments store) is still behind this flag on Node 22; a no-op on 24+.
ENV NODE_OPTIONS=--experimental-sqlite
EXPOSE 8795
WORKDIR /app/apps/pl8/backend
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]
