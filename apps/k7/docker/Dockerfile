# syntax=docker/dockerfile:1
#
# k7 — the rehearsal recorder, ONE process: the backend serves its own built frontend, no nginx,
# and this image deliberately does NOT start from `frediverse-base` (commons/dev/docker-runtime).
#
# The first three stages are byte-identical in the four studio Dockerfiles, so the installs are
# built once per lockfile and shared by all four — docs/images.md. Keep them identical.
#
# Build from the repo root: docker build -f apps/k7/docker/Dockerfile .

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
RUN npm run build --workspace k7-frontend

# ---- backend prod deps: k7-backend's closure only, no devDependencies --------
FROM toolchain AS backend-deps
RUN --mount=type=cache,target=/root/.npm npm ci --workspace k7-backend --omit=dev --no-audit --no-fund

# ---- final image --------------------------------------------------------------
FROM node:22-alpine AS runtime
# ffmpeg: decodes a take's envelope and mixes the instrumental — apps/k7/docs/audio.md.
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY --from=backend-deps /app ./
# The whole repo: @studio/* are symlinks to raw TypeScript source, so a missing package is a crash on import.
COPY . .
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
