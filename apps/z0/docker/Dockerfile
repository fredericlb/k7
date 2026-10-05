# syntax=docker/dockerfile:1
#
# z0 — the blind-test game, six SPAs behind one backend, and the one studio image still built on
# `frediverse-base`: nginx serves the six SPAs and proxies the backend (nginx.conf beside this file).
# That base image must be built first — commons/dev/docker-runtime/README.md.
#
# The first three stages are byte-identical in the four studio Dockerfiles, so the installs are
# built once per lockfile and shared by all four — docs/images.md. Keep them identical.
#
# Build from the repo root: docker build -f apps/z0/docker/Dockerfile .

ARG BASE_IMAGE=frediverse-base:latest

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

# ---- frontend builds: each of the six declares its own public prefix --------
FROM deps AS frontend-build
COPY . .
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
# vite alone: the lint job typechecks every workspace (docs/images.md).
RUN npm exec --workspace z0-online --workspace z0-buzzer --workspace z0-remote \
    --workspace z0-editor --workspace z0-presenter --workspace z0-monitor -- vite build

# ---- backend prod deps: z0-backend's closure only, no devDependencies --------
FROM toolchain AS backend-deps
RUN --mount=type=cache,target=/root/.npm npm ci --workspace z0-backend --omit=dev --no-audit --no-fund

# ---- final image --------------------------------------------------------------
FROM ${BASE_IMAGE} AS runtime
WORKDIR /app
COPY --from=backend-deps /app ./
# The whole repo: @studio/* are symlinks to raw TypeScript source, so a missing package is a crash on import.
COPY . .

# One folder per SPA, matching the PUBLIC prefixes nginx.conf routes on.
COPY --from=frontend-build /app/apps/z0/online/dist /usr/share/nginx/html/z0
COPY --from=frontend-build /app/apps/z0/buzzer/dist /usr/share/nginx/html/z0/buzzer
COPY --from=frontend-build /app/apps/z0/remote/dist /usr/share/nginx/html/z0/remote
COPY --from=frontend-build /app/apps/z0/editor/dist /usr/share/nginx/html/z0/editor
COPY --from=frontend-build /app/apps/z0/presenter/dist /usr/share/nginx/html/z0/presenter
COPY --from=frontend-build /app/apps/z0/monitor-web/dist /usr/share/nginx/html/z0/monitor
COPY apps/z0/docker/nginx.conf /etc/nginx/http.d/default.conf

ENV BACKEND_PORT=8080
EXPOSE 80
WORKDIR /app/apps/z0/backend
# Shell form so $EXTRA_FLAGS (e.g. `--latest`) expands at start, and `exec` so node gets the signals.
CMD ["sh", "-c", "exec node --experimental-strip-types src/server.ts $EXTRA_FLAGS"]
