ARG BASE_IMAGE=frediverse-base:latest

FROM node:22-alpine AS pruner
WORKDIR /repo
RUN npm install -g turbo@2
COPY . .
RUN turbo prune k7-backend k7-frontend --docker
RUN turbo prune k7-backend --docker --out-dir=out-backend

FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN npm ci

FROM deps AS frontend-build
WORKDIR /app
COPY --from=pruner /repo/out/full/ ./
# The build stamp "YY.MMDDHHmm" the buildspec also tags this image with, shown in
# the SPA chrome. A plain `docker build` leaves it "dev" — only CI claims a version.
# Declared here rather than before the first FROM so a new stamp busts this layer
# alone; see docs/versioning.md for why it is an ENV and not a RUN-line prefix.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build --workspace k7-frontend

FROM deps AS backend-deps
WORKDIR /app
RUN npm prune --omit=dev

FROM ${BASE_IMAGE} AS runtime
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=pruner /repo/out-backend/full/ ./

COPY --from=frontend-build /app/apps/k7/frontend/dist /usr/share/nginx/html
COPY apps/k7/docker/nginx.conf /etc/nginx/http.d/default.conf

VOLUME ["/app/apps/k7/backend/data"]

ENV PORT=8787

WORKDIR /app/apps/k7/backend
CMD ["node", "--experimental-strip-types", "--env-file-if-exists=.env", "src/server.ts"]
