# syntax=docker/dockerfile:1
#
# z0 — the blind-test game, six SPAs behind one backend. The one studio image still
# built on the shared `frediverse-base` (commons/dev/docker-runtime): unlike
# st0/pl8/k7, it hasn't moved to its own subdomain and still needs nginx to serve
# six separately-based SPAs and reverse-proxy its own backend — see nginx.conf
# beside this file, and docker/docker-compose.yml for how Traefik reaches it
# (a PathPrefix(`/z0`) rule on st0's own hostname, alongside a separate rule
# pointed at st0's own image).
#
# The final stage starts from the repo-root base image (nginx + shared
# entrypoint + proxy snippet), which must be built first — see
# commons/dev/docker-runtime/README.md.
#
# Build from the repo root: docker build -f apps/z0/docker/Dockerfile .

ARG BASE_IMAGE=frediverse-base:latest

# ---- deps: install this app's own workspace dependencies --------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY . .
RUN apk add --no-cache python3 make g++ \
 && npm ci --workspace z0-backend --workspace z0-online --workspace z0-buzzer \
    --workspace z0-remote --workspace z0-editor --workspace z0-presenter --workspace z0-monitor \
    --include-workspace-root

# ---- frontend builds -------------------------------------------------------
# Each of the six declares its own public prefix (`/z0/`, `/z0/<app>/`) — so
# nothing is passed in but the stamp, and the folders below mirror those
# prefixes exactly.
FROM deps AS frontend-build
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace z0-online \
 && npm run build --workspace z0-buzzer \
 && npm run build --workspace z0-remote \
 && npm run build --workspace z0-editor \
 && npm run build --workspace z0-presenter \
 && npm run build --workspace z0-monitor

# ---- backend prod deps -------------------------------------------------------
# A SEPARATE install, scoped to just z0-backend and its @studio/* dependency closure, is
# what the runtime stage ships — see apps/st0/docker/Dockerfile's comment for why this
# matters here.
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY . .
# node-pty (a root devDependency, pulled in even though this app doesn't use it) has no musl
# prebuild and falls back to node-gyp, which alpine ships neither python3 nor a C toolchain for.
RUN apk add --no-cache python3 make g++ \
 && npm ci --workspace z0-backend --omit=dev

# ---- final image --------------------------------------------------------------
FROM ${BASE_IMAGE} AS runtime
WORKDIR /app
# The whole repo, but with node_modules pruned to z0-backend's own runtime dependency
# closure only — no frontend-only deps, no devDependencies.
COPY --from=backend-deps /app ./

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
# EXTRA_FLAGS passes CLI flags to z0's server (e.g. `--latest`); unset is none. Shell form
# so it expands at container start, and `exec` so node replaces the shell rather than the
# entrypoint's signal handling reaching a shell instead of the process it means to stop.
CMD ["sh", "-c", "exec node --experimental-strip-types src/server.ts $EXTRA_FLAGS"]
