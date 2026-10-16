# Images, deployment and versioning

The hosted side of k7 ships as two Docker images built from this repository, run by
`docker/docker-compose.yml` behind an external Traefik.

| Image | Dockerfile | Registry name |
|---|---|---|
| k7 web app: the backend, the built frontend, the media library and the rehearsal recorder in one Node process | `apps/k7/docker/Dockerfile` | `dev.frediver.se/frediverse/k7/k7-webapp` |
| Server engine: `k7-runtime` and `k7-supervisor` | `engine/docker/Dockerfile` | `dev.frediver.se/frediverse/k7/k7-runtime` |

Both build with the repository root as context:

```bash
docker build -f apps/k7/docker/Dockerfile --build-arg APP_VERSION=dev .
docker build -f engine/docker/Dockerfile .
```

`.dockerignore` keeps `node_modules`, `dist`, `.git`, `.claude`, `env.yaml`, logs, Storybook output
and the native build folders (`engine/k7-runtime/build`, `engine/k7-supervisor/build`) out of the
build context.

## The k7 web app image

The stages:

| Stage | Base | Does |
|---|---|---|
| `manifests` | `node:22-alpine` | Copies the repository and extracts only every `package.json`, `package-lock.json` and `.npmrc`, so the install layers depend on manifests alone. |
| `toolchain` | `node:22-alpine` | Adds `python3`, `make`, `g++` (for `ssh2`'s optional native crypto binding) and the manifests. |
| `deps` | `toolchain` | `npm ci` of the whole workspace, with an npm cache mount. |
| `frontend-build` | `deps` | Copies the sources, sets `VITE_APP_VERSION` from the `APP_VERSION` build argument, runs `vite build` for `k7-frontend`. No typecheck here: CI typechecks separately. |
| `backend-deps` | `toolchain` | `npm ci --workspace k7-backend --omit=dev`: the backend's production dependency closure only. |
| `runtime` | `node:22-alpine` | Adds `yt-dlp`, `ffmpeg` and `mpv`; copies the backend's `node_modules`, **the whole repository**, and the built frontend into `apps/k7/frontend/dist`. |

The whole repository is copied because the `@studio/*` and `@frediverse/*` entries in
`node_modules` are symlinks to workspace source folders, consumed as TypeScript: a package left out
is a crash on first import. `npm run check-images` checks that closure.

Runtime settings:

| Setting | Value |
|---|---|
| Command | `tsx src/server.ts` in `apps/k7/backend` |
| `PORT` | `8789` (exposed) |
| `NODE_OPTIONS` | `--experimental-sqlite` |
| Volumes | `/data` (`STUDIO_PREFS_DIR=/data/prefs`), `/library` (`STUDIO_MEDIATEK`), `/workspaces`, `/rehearsal-data` (`K7_DATA_DIR`) |

The image does not start from the `commons` base runtime image and has no nginx: the backend serves
the SPA itself.

## The server engine image

`engine/docker/Dockerfile`:

- **`build`** (`node:22-bookworm`): installs the C++ toolchain, Ninja, ccache and the JUCE Linux
  dependencies; copies only `engine/k7-runtime`, `engine/k7-supervisor` and
  `packages/supervisor-host/scripts`; builds both with the `release-gcc` preset (engine tests off,
  supervisor target only) in one `RUN` with cache mounts for both build folders and ccache; stages the
  binaries into `/opt/k7` with `stageEngine`. `BUILD_JOBS` sets the parallelism (default: cores minus two).
- **`runtime`** (`debian:bookworm-slim`): `tini`, PulseAudio and ALSA's pulse plugin, a few shared
  libraries. The build fails if `ldd` reports a missing library. Runs as an unprivileged `k7` user
  (PulseAudio refuses root outside system mode), with `STUDIO_HOME=/engine-home` as a volume and
  `STUDIO_AUDIO_TO_BROWSER=1`.

`engine/docker/entrypoint.sh` starts PulseAudio with a 48 kHz stereo null sink named `k7` and then
the supervisor as the command-line engine, with its config in the home volume. `engine/docker/asound.conf`
routes ALSA to PulseAudio.

## The compose file

`docker/docker-compose.yml` runs four services on an external `traefik` network. Copy
`docker/.env.example` to `docker/.env`, fill it in, and run `docker compose up -d`.

| Service | Image | Notes |
|---|---|---|
| `k7` | `k7-webapp:${APP_VERSION:-latest}` | Routed by Traefik for `Host(K7_DOMAIN)`, `Host(DOCS_DOMAIN)`, `Host(LEGACY_DOMAIN)`, `Host(PL8_DOMAIN)` and `Host(K7_ALIAS_DOMAIN)` (defaults `app.k7.rocks`, `docs.k7.rocks`, and the former hosts `st0.app`, `play.st0.app`, `k7.st0.app`) on port 8789, TLS through `TRAEFIK_CERTRESOLVER`. Volumes `data`, `library`, `workspaces`, `k7-data`. |
| `engine` | `k7-runtime:${APP_VERSION:-latest}` | No published port and no Traefik route. Registers at `http://k7:8789` over the compose network (`STUDIO_REGISTRY_URL`), named `ENGINE_NAME`, with every sampled instrument (`STUDIO_INSTRUMENTS=all`). Volume `engine-home`. |
| `pocketbase` | `ghcr.io/muchobien/pocketbase` | Only the source of the rehearsal recorder's one-time import into its SQLite store. Publishes `POCKETBASE_PORT` directly on the host, without Traefik: firewall it. Remove it, its volume and the `POCKETBASE_*` variables once k7 has logged the import. |
| `z0` | `dev.frediver.se/frediverse/z0:${Z0_VERSION:-latest}` | The blind-test game, built by its own repository. Routed for `Host(K7_DOMAIN) && PathPrefix(/z0)` with priority 10, so it wins over k7's host rule. |

Environment, shared by `k7` and `z0` through a YAML anchor: `SESSION_SECRET` (required: compose
refuses to start without it), `COOKIE_DOMAIN`, `TRUSTED_ORIGINS` and the `OIDC_*` variables. Both
services verify the same `studio.sid` cookie, which k7 mints.

Further `k7` variables:

| Variable | Purpose |
|---|---|
| `API_TOKEN_SECRET` | Signs the media library's bearer tokens; unset derives one from `SESSION_SECRET`. |
| `K7_API_TOKEN_SECRET` | Signs the rehearsal recorder's personal tokens; unset keeps the value derived from `SESSION_SECRET`. |
| `AUTH_ADMIN_GROUPS` | OIDC groups that edit the shared libraries (and z0's admins). |
| `RENDER_KEY` → `STUDIO_RENDER_KEY` | Shared with the `engine` service: an engine presenting it on the tunnel becomes k7's render machine, since the web image has no engine binary. Unset, k7 renders only on an account's own engine. |
| `STUDIO_MEDIATEK=/library`, `STUDIO_FILES_ROOT=/workspaces`, `K7_DATA_DIR=/rehearsal-data` | Fixed paths onto the volumes. |

`COOKIE_DOMAIN` is for production only: setting it forces `Secure` and `SameSite=None` cookies,
which browsers drop over plain http.

## The version stamp

OneDev's `build studio images` job computes the stamp as `YY.MMDDHHmm` in the Europe/Paris time zone
(UTC if the image has no time zone data), for example `26.10161432`. It is:

- the OneDev build version;
- passed as `--build-arg APP_VERSION=<stamp>` to the web image, which sets `VITE_APP_VERSION` for the
  frontend build. `apps/k7/frontend/src/version.ts` exports it as `VERSION` (`"dev"` when unset), and
  the home sidebar shows it as the tooltip of the `k7` wordmark
  (`apps/k7/frontend/src/projects/HomeSidebar.tsx`);
- the tag `publish studio images` adds to both images, beside `:latest`.

Images are first pushed under the commit hash only. `:latest` and `:<stamp>` are added after
`lint and test` and both image builds succeed, so nothing deployable points at an untested commit.
To deploy a specific build, set `APP_VERSION` in `docker/.env` to a stamp or a commit hash; it
applies to both the web and the engine image. `Z0_VERSION` is pinned separately.

The backend serves the frontend shell with `Cache-Control: no-cache` and the hashed files under
`assets/` as `public, max-age=31536000, immutable`, so a new deployment is picked up on the next page
load. A request for a hashed asset that no longer exists returns 404 rather than the shell.

Desktop and phone releases use a different stamp: see [Releases and publishing](./09-releases-and-publishing.md).
