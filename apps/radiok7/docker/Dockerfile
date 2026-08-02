ARG BASE_IMAGE=frediverse-base:latest

FROM node:22-alpine AS pruner
WORKDIR /repo
RUN npm install -g turbo@2
COPY . .
RUN turbo prune radiok7-backend radiok7-frontend --docker
RUN turbo prune radiok7-backend --docker --out-dir=out-backend

FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN npm ci

FROM deps AS frontend-build
WORKDIR /app
COPY --from=pruner /repo/out/full/ ./
RUN npm run build --workspace radiok7-frontend

FROM deps AS backend-deps
WORKDIR /app
RUN npm prune --omit=dev

FROM ${BASE_IMAGE} AS runtime
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=pruner /repo/out-backend/full/ ./

COPY --from=frontend-build /app/apps/radiok7/frontend/dist /usr/share/nginx/html
COPY apps/radiok7/docker/nginx.conf /etc/nginx/http.d/default.conf

VOLUME ["/app/apps/radiok7/backend/data"]

ENV PORT=8787

WORKDIR /app/apps/radiok7/backend
CMD ["node", "--experimental-strip-types", "--env-file-if-exists=.env", "src/server.ts"]
