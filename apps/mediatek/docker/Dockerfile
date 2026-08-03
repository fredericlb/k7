# syntax=docker/dockerfile:1
#
# mediatek — the hosted media library: the SPA plus its own Node backend over a
# volume of files, in one single-origin container. The final stage starts from
# the repo-root base image (nginx + shared entrypoint + proxy snippet), which
# must be built first — see .onedev-buildspec.yml.
#
# Unlike pistes's image this one is STATEFUL, and that is the whole point: the
# library IS the volume. There is no database anywhere — a directory tree is the
# index (see packages/mediatek/docs/index.md), which is exactly what it also is
# on the machine that caches it, so one scanner serves both sides.
#
#   apps/mediatek/frontend  the SPA (catalogue + module builder) -> nginx on :80
#   apps/mediatek/backend   the library over HTTP -> node on :8795, at /api /auth
#
# The module BUILDER lives in this SPA, because only the médiathèque is editable
# — a workspace's `_modules` is a read-only mirror. It also talks to a local
# apps/moteur over a WebSocket, direct and cross-origin, to ask a plugin what its
# parameters are; that never comes through this origin.

# ---- prune: cut the monorepo down to what mediatek needs --------------------
# `turbo prune` computes the workspace subset and emits a matching pruned
# lockfile, so this Dockerfile never hand-lists workspaces.
ARG BASE_IMAGE=frediverse-base:latest

FROM node:22-alpine AS pruner
WORKDIR /repo
RUN npm install -g turbo@2
COPY . .
RUN turbo prune mediatek-frontend mediatek-backend --docker
# A SECOND prune, scoped to the backend alone, is what the runtime stage ships:
# mediatek-backend + @studio/mediatek + @frediverse/{http,oidc} and nothing else
# — no frontend source, and none of the engine packages the builder uses in the
# BROWSER. node_modules/@studio/* are symlinks into the workspace, so a package
# missing from the image is a dangling link and a crash on first import.
RUN turbo prune mediatek-backend --docker --out-dir=out-backend

# ---- deps: install from the pruned lockfile --------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN npm ci

# ---- frontend build --------------------------------------------------------
# `build` is `vite build && tsc --noEmit`, so a type error fails the image. The
# SPA consumes @frediverse/ui and @studio/* as raw source through the prune
# closure; @frediverse/ui in particular MUST be present, because index.css
# `@source`s commons/packages/ui/src and Tailwind silently emits NOTHING for a @source
# path that does not exist — the app then builds fine and renders unstyled.
FROM deps AS frontend-build
WORKDIR /app
COPY --from=pruner /repo/out/full/ ./
# The build stamp "YY.MMDDHHmm" the buildspec also tags this image with, shown in
# the SPA chrome. A plain `docker build` leaves it "dev" — only CI claims a version.
# Declared here rather than before the first FROM so a new stamp busts this layer
# alone; see docs/versioning.md for why it is an ENV and not a RUN-line prefix.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace mediatek-frontend

# ---- backend prod deps -----------------------------------------------------
# Production-only, from the backend-only prune, so the runtime tree carries
# neither the frontend's dependency set nor the repo-root toolchain
# (biome/turbo/vite/esbuild — devDependencies a `npm ci` here would otherwise
# pull in through the root package.json).
#
# `tsx` survives because it is a real dependency of the backend, not a
# devDependency: this service runs its TypeScript directly, so the interpreter
# is part of the runtime. Node's own type stripping is not a substitute — it
# refuses to strip types inside node_modules, and @studio/mediatek is consumed
# as .ts source from exactly there.
FROM node:22-alpine AS backend-deps
WORKDIR /app
COPY --from=pruner /repo/out-backend/json/ ./
RUN npm ci --omit=dev

# ---- final image -----------------------------------------------------------
FROM ${BASE_IMAGE} AS runtime
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=pruner /repo/out-backend/full/ ./

COPY --from=frontend-build /app/apps/mediatek/frontend/dist /usr/share/nginx/html
COPY apps/mediatek/docker/nginx.conf /etc/nginx/http.d/default.conf

# The library itself. Declared so a `docker run` with no -v still starts with an
# anonymous volume instead of writing into the container layer, where an upload
# would survive exactly until the next deploy.
VOLUME ["/library"]

ENV PORT=8795
# The backend REFUSES TO BOOT without this (see backend/src/server.ts): a
# missing root would otherwise scan an empty directory and serve a plausible,
# empty catalogue — a library that has silently lost everything looks exactly
# like a library nobody has filled yet.
ENV STUDIO_MEDIATEK=/library

WORKDIR /app/apps/mediatek/backend
# Invoked by absolute path rather than through npm, so the process the base
# image's entrypoint supervises (and signals) is the server itself.
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]
