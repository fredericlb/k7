# Dev setup and `npm run dev`

## Prerequisites

| Tool | Why |
|---|---|
| Node.js 24 (`engines` in `package.json`; CI and the image use the same version, `.nvmrc`) | Everything TypeScript. The backend relies on `node:sqlite`, which needs no flag on it. |
| npm 10 | The workspace manager (`devEngines` in `package.json`). |
| [Tilt](https://docs.tilt.dev/install.html) | Runs the dev session. `npm run dev` exits with a pointer to the install page if `tilt` is missing. |
| Access to the `commons` submodule | Install, lint and build all need it. |
| CMake, Ninja and a C++ toolchain (AppleClang on macOS, MSVC on Windows) | Only for the `k7-tray` resource, which builds and runs the engine (and Rust, for the tray itself and the supervisor's audio decoder). |
| `yt-dlp` and `ffmpeg` on `PATH` | Optional: media imports and some audio processing in the backend. The UI greys out the YouTube import when `yt-dlp` is absent. |

## First checkout

```bash
git submodule update --init      # commons
npm install
cp env.example.yaml env.yaml     # then fill it in
npm run tokens                   # optional: gives the backend its own API_TOKEN_SECRET
```

`env.yaml` is the per-machine configuration and is gitignored (`env.yaml*`, so backups are ignored
too). It has a `common` section applied to every service and one section per service named after
the service's **package name**; `k7-backend` is the one that matters here. The backend reads it with
`loadServiceEnv("k7-backend")` from `@frediverse/env`, which finds the nearest `env.yaml` walking up
from the working directory and layers `common` then the service section into `process.env`. Under a
test runner it does not go looking for the file, so tests never pick up a developer's secrets.

The keys you need in dev:

| Key | Section | Notes |
|---|---|---|
| `STUDIO_FILES_ROOT` | `k7-backend` | **Required.** Where the accounts' workspaces live; the backend exits without it. |
| `STUDIO_MEDIATEK` | `k7-backend` | The media library folder. Defaults to `~/.k7/mediatek`. |
| `SESSION_SECRET` | `common` | Signs the session cookie. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES` | `common` | Leave empty to sign in as the "Dev User" stub. `OIDC_SCOPES` empty is `openid profile email groups`; a value set must include `groups` for admin checks to work. |
| `AUTH_ADMIN_GROUPS` | `k7-backend` | OIDC groups whose members edit the shared libraries. |
| `API_TOKEN_SECRET` | `k7-backend` | Written by `npm run tokens`; falls back to a value derived from `SESSION_SECRET`. |
| `COOKIE_DOMAIN` | `common` | Leave empty for local http: setting it forces `Secure` and `SameSite=None`. |

`env.example.yaml` documents the remaining optional keys (rehearsal store, prefs folder, slskd, MusicBrainz user agent, `YTDLP_BIN`).

Machine state that is not configuration (the engine's identity, plugin cache, downloaded
instruments, project copies) lives in `~/.k7`, or in `$STUDIO_HOME` when set
(`scripts/stateDir.mjs` mirrors `packages/song/src/studioHome.ts` for the plain-Node scripts).

## `npm run dev`

`npm run dev` runs `scripts/dev.mjs`, which:

1. refuses to start if port `10350` is taken, because a second session would fight the first for
   every dev port; the message points at the running session's Tilt UI;
2. runs `tilt up --port 10350`, passing any extra arguments through;
3. on `SIGINT`/`SIGTERM` or Tilt's exit, kills Tilt and then stops any engine still running
   (`stopAll()` from `engine/scripts/devEngine.mjs`), since Tilt may end the tray resource too abruptly
   for it to stop its own engine.

The Tilt UI is at `http://localhost:10350`. Each dev server is its own resource that you can
restart, read logs from, or trigger on its own:

```bash
npm run dev                          # every resource
npm run dev -- k7-frontend k7-backend   # only these resources
tilt trigger k7-backend              # restart one from another terminal
tilt logs native                     # read one resource's output
tilt get uiresources                 # status of every resource
```

### Where the resource list comes from

The `Tiltfile` asks `scripts/tilt-tasks.mjs` for the task list. That script walks the workspace globs
of the root `package.json` and takes every workspace that has a `dev` script, except:

- **aggregators**, whose `dev` starts with `concurrently` (`apps/k7` would start the frontend and
  backend a second time);
- **typecheck watchers**, whose `dev` runs `tsc --watch` (most `packages/*` have one).

Each remaining workspace becomes a `local_resource` that runs `npm run dev` in its folder, labelled by
its top-level folder (`apps` or `engine`). The resource is named after the package. A new app joins the session by having a `dev` script; nothing in the
`Tiltfile` changes. Today the list is:

| Resource | Workspace | Runs |
|---|---|---|
| `k7-frontend` | `apps/k7/frontend` | `vite` |
| `k7-backend` | `apps/k7/backend` | `tsx watch src/server.ts` with `STUDIO_FILES_WATCH=1` |
| `k7-tray` | `apps/k7-tray` | `scripts/dev-tray.mjs` |
| `studio-k7-android-shell` | `engine/k7-android/web` | `vite` for the Android app's page |

### Ports and hosts

| Server | Port | Notes |
|---|---|---|
| k7 backend | `8789` (`PORT`) | Also the production port. |
| k7 frontend | `5223`, or `$STUDIO_WEB_PORT` | `strictPort`: a clash is a hard failure. Proxies `/api` and `/auth` to the backend, and upgrades WebSockets on `/api/engine`, `/api/sync` and `/rtc`. The backend URL can be moved with `$STUDIO_BACKEND_URL`. |

Without `STUDIO_WEB_PORT` the frontend dev server declares the public dev host `app.priv.k7.rocks`
(`scripts/dev-hosts.mjs`) and points HMR at port 443, for a reverse proxy in front of it. It also
accepts the docs host `docs.priv.k7.rocks` and the former dev hosts `priv.st0.app`,
`play.priv.st0.app` and `k7.priv.st0.app`. Set `STUDIO_WEB_PORT` to run it on a
plain local port with HMR on that port. `STUDIO_POLL=1` switches the file watcher to polling for
trees where native file events do not arrive.

### The `k7-tray` resource

`scripts/dev-tray.mjs` (also runnable alone as `npm run dev:tray`) builds the engine, the supervisor,
k7's backend bundle and the tray, runs the tray on those builds, then rebuilds and restarts on save:

- At start it stops every tray, supervisor and engine on the machine, an installed tray included (it
  holds port 18789, and its single-instance guard would swallow the dev one). It builds k7's frontend
  and the backend bundle into the tray workspace's gitignored `.dev` folder every time, then the engine, the supervisor and the
  tray if a binary is missing or older than its newest watched source. A failed bundle ends the task.
- The tray runs from `apps/k7-tray/src-tauri/target/debug`, pointed at the bundle
  (`K7_BACKEND_BUNDLE`) and the supervisor build (`STUDIO_ENGINE_HOST_CMD`). k7 answers at
  `http://127.0.0.1:18789`; the tray's backend runs the supervisor on `~/.k7`. For the dev web app to
  reach the same engine, list `https://app.priv.k7.rocks` on the engine page: a loopback address such
  as `http://localhost:8789` would be the tray's own backend to the supervisor, and is dropped.
- It watches `engine/k7-runtime/engine`, `engine/k7-runtime/server` (C++ sources), the
  `CMakeLists.txt`/`CMakePresets.json` of both projects, `engine/k7-supervisor/src`, and the tray's
  `src-tauri/src`, `Cargo.toml` and `tauri.conf.json`. Tests are not watched, nor is the bundle's
  source: frontend and backend work belongs to their own resources, and Tilt's restart rebuilds the
  bundle.
- A save is debounced by 500 ms. A cycle stops the tree (a running image cannot be relinked on
  Windows), rebuilds the engine, then the supervisor, then the tray, and starts the tray again. A save
  during a build queues another cycle. A failed build leaves the tray stopped and retries on the next
  save.
- After an engine build it checks that the binary is newer than its sources, and fails loudly if a
  build reported success without replacing the image.
- The engine build is `npm run build:mac` or `npm run build:win` in the `k7-runtime` workspace, the
  tray's `cargo build`. On Linux there is no engine build script, so it leaves the existing build
  alone, and recursive file watching is unavailable, so there is no auto-rebuild.

The engine build scripts take a lock on the build folder and cap the number of compilers
(`engine/k7-runtime/scripts/buildLock.mjs`). `npm run test --workspace k7-runtime` takes the same
lock, so it waits for the watcher rather than corrupting the build folder. Never start another
`cmake --build` of the same tree by hand while `k7-tray` is running.

### Other dev entry points

| Command | What it starts |
|---|---|
| `npm run stage --workspace k7-tray`, then `npm run tauri dev --workspace k7-tray` | The tray from source (`tauri dev`), on the staged backend bundle and engine. |
| `npm run storybook` | Storybook on port 6006, with stories from `packages/*/src` and `apps/*/frontend/src`. |

## Windows

The scripts run on native Windows (Node, MSVC, Git Bash). What they do differently there:

- **No POSIX env prefixes in npm scripts.** npm hands scripts to `cmd.exe`, which cannot read
  `VAR=1 tool`. The backend's scripts go through `apps/k7/backend/scripts/with-env.mjs`, which sets
  the variables and spawns the tool's declared `bin` with `node`, with no shell involved.
- **`npm` is a `.cmd` shim**, so scripts that spawn it pass `shell: true` on `win32`.
- **A running executable cannot be relinked**, which is why `dev-tray.mjs` stops the tree before
  every rebuild and why a build that "succeeds" without updating the binary is reported as an error.
- **Line endings**: `.gitattributes` forces LF on checkout so that Biome's formatter does not report
  every file of a `core.autocrlf=true` checkout.
- **Engine preset**: `windows-msvc` locally; CI uses `windows-msvc-ninja` for compiler caching.

Three scripts exist for a Windows dev box reached remotely; they are not part of the dev session:

| Command | What it does |
|---|---|
| `npm run vscode` | `scripts/vscode.mjs`: VS Code's `code serve-web` on port 8798, opening on the user's home with Git Bash as terminal. A busy port counts as success. |
| `npm run console` | `scripts/console/server.mjs`: shared terminal tabs on port 8797 (PowerShell in ConPTYs owned by the service, so they outlive the browser tab; at most 12 tabs). Installs its own dependencies first. |
| `npm run remote:install` / `remote:uninstall` / `remote:status` | `scripts/remote.mjs`: registers (or removes, or reports) Windows logon tasks that keep the two services above running outside Tilt, relaunched with backoff, logging to the temp folder. `scripts/hidden.vbs` runs them without a console window. |
