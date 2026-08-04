# syntax=docker/dockerfile:1
#
# z0 — six SPAs + the Node backend in one container, on ONE origin.
# The final stage starts from the repo-root base image, but z0 overrides
# the shared entrypoint: it deliberately *supervises* and restarts its backend
# rather than taking the container down with it (see docker/entrypoint.sh).
#
# Layout served by nginx (docker/nginx.conf), matching the dev Caddyfile:
#   /           online      /buzzer  buzzer     /remote  remote
#   /editor     editor      /presenter presenter  /monitor monitor
#   /api        backend (prefix stripped), plus /auth /audio /ws
#
# Nothing here takes a DOMAIN/host build-arg: every URL is same-origin and
# relative, so one image works in any deployment without a rebuild.

# ---- prune -----------------------------------------------------------------
# `turbo prune` computes z0's workspace subset + a matching pruned
# lockfile, replacing the hand-maintained list of workspace COPY lines. Scoped
# to what the image ships: the backend and all six SPAs.
ARG BASE_IMAGE=frediverse-base:latest

FROM node:22-alpine AS pruner
WORKDIR /repo
RUN npm install -g turbo@2
COPY . .
RUN turbo prune \
    z0-backend \
    z0-online \
    z0-buzzer \
    z0-remote \
    z0-editor \
    z0-presenter \
    z0-monitor \
    --docker
# A SECOND prune, scoped to the backend alone, is what the runtime stage ships:
# turbo computes the backend's exact workspace closure and nothing else (no SPA
# source). The runtime stage copies it wholesale instead of hand-listing each
# workspace — node_modules/@frediverse/* are symlinks into the workspace, so a
# package missing from the image is a dangling link and a crash on first import,
# and a hand-maintained list silently goes stale (it has, twice).
RUN turbo prune z0-backend --docker --out-dir=out-backend

# ---- deps ------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN npm ci

# ---- SPA builds ------------------------------------------------------------
# The SPAs import @frediverse/ui and @frediverse/api-client; the pruned tree
# brings them along. Each SPA's vite `base` pins its assets to its own prefix,
# so the six dists can be dropped side by side under one docroot.
FROM deps AS frontend-build
WORKDIR /app
COPY --from=pruner /repo/out/full/ ./
# The build stamp "YY.MMDDHHmm" the buildspec also tags this image with, shown in
# each SPA's chrome. A plain `docker build` leaves it "dev" — only CI claims a
# version. It is an ENV rather than phare's `RUN VITE_APP_VERSION=… npm run build`
# prefix precisely because of the && chain below: a command-prefix assignment
# applies to the FIRST command only, so five of these six would ship "dev".
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace z0-online \
 && npm run build --workspace z0-buzzer \
 && npm run build --workspace z0-remote \
 && npm run build --workspace z0-editor \
 && npm run build --workspace z0-presenter \
 && npm run build --workspace z0-monitor

# ---- backend prod deps -----------------------------------------------------
FROM deps AS backend-deps
WORKDIR /app
RUN npm prune --omit=dev

# ---- final image -----------------------------------------------------------
FROM ${BASE_IMAGE} AS runtime
# ffmpeg: the Grist track-loader trims + re-encodes every audio attachment to
# libopus/webm at cache time.
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
# The backend's whole workspace closure, computed by the backend-only prune
# above — every package its node_modules symlinks point at, and no SPA source.
COPY --from=pruner /repo/out-backend/full/ ./

# online owns the docroot; the other five mount under their own prefix. The
# directory names must match both each SPA's vite `base` and the nginx
# locations.
COPY --from=frontend-build /app/apps/z0/online/dist /usr/share/nginx/html
COPY --from=frontend-build /app/apps/z0/buzzer/dist /usr/share/nginx/html/buzzer
COPY --from=frontend-build /app/apps/z0/remote/dist /usr/share/nginx/html/remote
COPY --from=frontend-build /app/apps/z0/editor/dist /usr/share/nginx/html/editor
COPY --from=frontend-build /app/apps/z0/presenter/dist /usr/share/nginx/html/presenter
COPY --from=frontend-build /app/apps/z0/monitor-web/dist /usr/share/nginx/html/monitor

COPY apps/z0/docker/nginx.conf /etc/nginx/http.d/default.conf
# Overrides the base image's shared entrypoint (same path) with the supervising
# variant; the base's ENTRYPOINT already points at /entrypoint.sh.
COPY apps/z0/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# No volume: the only thing this backend writes is the Grist attachment cache,
# and src/state.ts now puts that in a fresh temp directory per launch (the
# container's own writable layer), re-fetching from Grist as needed. Game state
# was never on disk — state/persist.ts write-behinds it to Grist.
# EXTRA_FLAGS passes CLI flags to the server (e.g. `--latest`).
ENV BACKEND_PORT=8080

# 8080 — backend, exposed directly for deployments that skip the nginx.
# (:80 for nginx comes from the base image.)
EXPOSE 8080

WORKDIR /app/apps/z0/backend
