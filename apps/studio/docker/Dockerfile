# syntax=docker/dockerfile:1
#
# studio — every HOSTED app of this repo in ONE single-origin container: st0 at
# the root, l8 and k7 under their prefixes, z0's six SPAs under /z0 — four
# backends beside one nginx that owns the origin's path routing. Same shape as
# phare's monolith (apps/phare/docker), with nothing left outside it: no studio
# service plays douane's role of deploying on its own cadence.
#
# The engine (engine/moteur) and the tray (engine/capot) are not here and never
# will be: they run on the musician's own machine, beside the audio interface.
#
# The final stage starts from the repo-root base image (nginx + shared
# entrypoint + proxy snippet), which must be built first — see
# commons/docs/images.md and .onedev-buildspec.yml.

# ---- prune: cut the monorepo down to what the four apps need ---------------
ARG BASE_IMAGE=frediverse-base:latest

FROM node:22-alpine AS pruner
WORKDIR /repo
RUN npm install -g turbo@2
COPY . .
RUN turbo prune st0-frontend st0-backend l8-frontend l8-backend \
    k7-frontend k7-backend z0-backend z0-online z0-buzzer z0-remote \
    z0-editor z0-presenter z0-monitor --docker
# A SECOND prune, scoped to the backends alone, is what the runtime stage
# ships: turbo computes their exact workspace closure and no frontend source.
# node_modules/@studio/* are symlinks into the workspace, so a package missing
# from the image is a dangling link and a crash on first import — and here that
# bites harder than anywhere else, because these packages are consumed as raw
# TYPESCRIPT SOURCE rather than as build output.
RUN turbo prune st0-backend l8-backend k7-backend z0-backend \
    --docker --out-dir=out-backend

# ---- deps: install from the pruned lockfile --------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN npm ci

# ---- frontend builds -------------------------------------------------------
# Each vite config declares its own public prefix — none for st0 (it IS the
# origin root), `/l8/`, `/k7/`, `/z0/` and `/z0/<app>/` — so nothing is passed
# in but the stamp, and the folders below mirror those prefixes exactly.
FROM deps AS frontend-build
WORKDIR /app
COPY --from=pruner /repo/out/full/ ./
# The vite configs import the repo-root scripts/dev-hosts.mjs, which turbo
# prune does not carry (it only keeps workspace directories).
COPY scripts ./scripts
# The build stamp "YY.MMDDHHmm" the buildspec also tags this image with, shown
# in every SPA's chrome. A plain `docker build` leaves it "dev" — only a CI
# build claims a version.
#
# ENV, and NOT phare's `RUN VITE_APP_VERSION=… npm run build` command prefix:
# a shell assignment prefixes ONE command, so in the chain below it would stamp
# st0 and ship the other eight as "dev" — no error, eight wrong SPAs. Declared
# after the FROM so a new stamp busts this layer alone. See docs/versioning.md.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace st0-frontend \
 && npm run build --workspace l8-frontend \
 && npm run build --workspace k7-frontend \
 && npm run build --workspace z0-online \
 && npm run build --workspace z0-buzzer \
 && npm run build --workspace z0-remote \
 && npm run build --workspace z0-editor \
 && npm run build --workspace z0-presenter \
 && npm run build --workspace z0-monitor

# ---- backend prod deps -----------------------------------------------------
# `tsx` survives this because it is a real dependency of st0's and l8's
# backends, not a devDependency: those two run their TypeScript directly, and
# Node's own type stripping is not a substitute — it refuses to strip types
# inside node_modules, which is exactly where @studio/* is read from.
FROM deps AS backend-deps
WORKDIR /app
RUN npm prune --omit=dev

# ---- final image -----------------------------------------------------------
FROM ${BASE_IMAGE} AS runtime
# git + openssh-client: st0 owns the account's repositories and the deploy key.
# yt-dlp: the médiathèque's imports. ffmpeg: k7's takes, z0's audio, st0's
# transcodes — one copy now serves all three.
RUN apk add --no-cache git openssh-client yt-dlp ffmpeg
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=pruner /repo/out-backend/full/ ./

# One folder per app, matching the PUBLIC prefixes: the edge sends this
# container the whole origin UNSTRIPPED and the nginx.conf beside this file
# does the path routing itself. st0 lands at the root — its index.html and
# assets/ beside the other apps' folders — because it answers the origin.
COPY --from=frontend-build /app/apps/st0/frontend/dist /usr/share/nginx/html/
COPY --from=frontend-build /app/apps/l8/frontend/dist /usr/share/nginx/html/l8
COPY --from=frontend-build /app/apps/k7/frontend/dist /usr/share/nginx/html/k7
COPY --from=frontend-build /app/apps/z0/online/dist /usr/share/nginx/html/z0
COPY --from=frontend-build /app/apps/z0/buzzer/dist /usr/share/nginx/html/z0/buzzer
COPY --from=frontend-build /app/apps/z0/remote/dist /usr/share/nginx/html/z0/remote
COPY --from=frontend-build /app/apps/z0/editor/dist /usr/share/nginx/html/z0/editor
COPY --from=frontend-build /app/apps/z0/presenter/dist /usr/share/nginx/html/z0/presenter
COPY --from=frontend-build /app/apps/z0/monitor-web/dist /usr/share/nginx/html/z0/monitor
COPY apps/studio/docker/nginx.conf /etc/nginx/http.d/default.conf
COPY apps/studio/docker/run-backends.sh /run-backends.sh
RUN chmod +x /run-backends.sh

# Three volumes, three different things worth keeping, all on distinct paths:
#   /library                        the médiathèque — st0 IS its volume
#   /data                           l8's per-person preferences
#   /app/apps/k7/backend/data       k7's sessions and takes
VOLUME ["/library", "/data", "/app/apps/k7/backend/data"]

# Container-wide because these names are unique to one backend each. The PORTs
# are not: they are fixed per process in the launcher, since one container has
# one environment and four backends would collide four ways on `PORT`.
ENV STUDIO_MEDIATEK=/library
ENV STUDIO_PREFS_DIR=/data/prefs

# The base image's entrypoint runs this alongside nginx; the script exits when
# any backend dies, which tears the container down for a clean restart.
CMD ["/run-backends.sh"]
