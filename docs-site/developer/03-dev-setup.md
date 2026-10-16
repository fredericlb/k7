# Dev setup and `npm run dev`

## Prerequisites

| Tool | Why |
|---|---|
| Node.js 24 (`engines` in `package.json`; CI and the image use the same version, `.nvmrc`) | Everything TypeScript. The backend relies on `node:sqlite`, which needs no flag on it. |
| npm 10 | The workspace manager (`devEngines` in `package.json`). |
| [Tilt](https://docs.tilt.dev/install.html) | Runs the dev session. `npm run dev` exits with a pointer to the install page if `tilt` is missing. |
| Access to the `commons` submodule | Install, lint and build all need it. |
| CMake, Ninja and a C++ toolchain (AppleClang on macOS, MSVC on Windows) | Only for the `native` resource, which builds and runs the engine. |
| `yt-dlp` and `ffmpeg` on `PATH` | Optional: media imports and some audio processing in the backend. The UI greys out the YouTube import when `yt-dlp` is absent. |

## First checkout

```bash
git submodule update --init      # commons
npm install                      # also installs the pre-push hook (the `prepare` script)
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
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES` | `common` | Leave empty to sign in as the "Dev User" stub. `OIDC_SCOPES` must include `groups` for admin checks to work. |
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
   (`stopAll()` from `engine/scripts/devEngine.mjs`), since Tilt may end the native resource too abruptly
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
its top-level folder (`apps` or `engine`). The resource is named after the package, with
`k7-runtime` renamed `native`. A new app joins the session by having a `dev` script; nothing in the
`Tiltfile` changes. Today the list is:

| Resource | Workspace | Runs |
|---|---|---|
| `k7-frontend` | `apps/k7/frontend` | `vite` |
| `k7-backend` | `apps/k7/backend` | `tsx watch src/server.ts` with `STUDIO_FILES_WATCH=1` |
| `native` | `engine/k7-runtime` | `scripts/dev-native.mjs` |
| `studio-k7-android-shell` | `engine/k7-android/web` | `vite` for the Android app's page |

### Ports and hosts

| Server | Port | Notes |
|---|---|---|
| k7 backend | `8789` (`PORT`) | Also the production port. |
| k7 frontend | `5223`, or `$STUDIO_WEB_PORT` | `strictPort`: a clash is a hard failure. Proxies `/api` and `/auth` to the backend, and upgrades WebSockets on `/api/engine`, `/api/sync` and `/rtc`. The backend URL can be moved with `$STUDIO_BACKEND_URL`. |

Without `STUDIO_WEB_PORT` the frontend dev server declares the public dev host `priv.st0.app`
(`scripts/dev-hosts.mjs`) and points HMR at port 443, for a reverse proxy in front of it. It also
accepts the `play.priv.st0.app` and `k7.priv.st0.app` aliases. Set `STUDIO_WEB_PORT` to run it on a
plain local port with HMR on that port. `STUDIO_POLL=1` switches the file watcher to polling for
trees where native file events do not arrive.

### The `native` resource

`scripts/dev-native.mjs` (also runnable alone as `npm run dev:native`) builds and runs the engine
and the supervisor, then rebuilds them on save:

- At start it stops any engine left by a previous session or an installed app, then builds the
  engine if there is no binary or if the newest watched source is newer than it, and the supervisor
  likewise. With nothing stale it still runs one cycle, which is what starts the engine.
- It watches `engine/k7-runtime/engine`, `engine/k7-runtime/server` (C++ sources) and the
  `CMakeLists.txt`/`CMakePresets.json` of both projects, plus `engine/k7-supervisor/src`. Tests are
  not watched.
- A save is debounced by 500 ms. A cycle stops the engine (a running image cannot be relinked on
  Windows), rebuilds the engine first and then the supervisor, and relaunches the supervisor as the
  command-line engine. A save during a build queues another cycle. A failed build leaves the engine
  stopped and retries on the next save.
- After an engine build it checks that the binary is newer than its sources, and fails loudly if a
  build reported success without replacing the image.
- The engine build is `npm run build:mac` or `npm run build:win` in the `k7-runtime` workspace. On
  Linux there is no build script, so it leaves the existing build alone, and recursive file watching
  is unavailable, so there is no auto-rebuild.

The engine build scripts take a lock on the build folder and cap the number of compilers
(`engine/k7-runtime/scripts/buildLock.mjs`). `npm run test --workspace k7-runtime` takes the same
lock, so it waits for the watcher rather than corrupting the build folder. Never start another
`cmake --build` of the same tree by hand while `native` is running.

### Other dev entry points

| Command | What it starts |
|---|---|
| `npm run desktop:dev` | The desktop app from source (`npm start` in `apps/k7-standalone`: builds the Electron main bundle, then starts it). |
| `npm run storybook` | Storybook on port 6006, with stories from `packages/*/src` and `apps/*/frontend/src`. |

## Windows

The scripts run on native Windows (Node, MSVC, Git Bash). What they do differently there:

- **No POSIX env prefixes in npm scripts.** npm hands scripts to `cmd.exe`, which cannot read
  `VAR=1 tool`. The backend's scripts go through `apps/k7/backend/scripts/with-env.mjs`, which sets
  the variables and spawns the tool's declared `bin` with `node`, with no shell involved.
- **`npm` is a `.cmd` shim**, so scripts that spawn it pass `shell: true` on `win32`.
- **A running executable cannot be relinked**, which is why `dev-native.mjs` stops the engine before
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
