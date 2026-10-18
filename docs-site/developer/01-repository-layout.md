# Repository layout

The `studio` repository holds k7 and everything it is built from: the web app, its backend, the
shared TypeScript packages, the C++ engine and its supervisor, the desktop and phone shells, and
the module library k7 ships with. It is one npm workspace tree driven from the root
`package.json`.

## Top-level folders

| Folder | What lives there |
|---|---|
| `apps/` | The applications: `apps/k7` (the web app: `frontend/` and `backend/`) and `apps/k7-standalone` (the Electron desktop app). |
| `packages/` | The shared `@studio/*` packages, consumed as raw TypeScript source. |
| `engine/` | The native side: `k7-runtime` (the C++ audio engine), `k7-supervisor` (the C++ program that runs and watches it), `k7-android` (the phone app, Gradle), `scripts` (the Node scripts that build and package the native binaries) and `docker` (the server engine's image). |
| `commons/` | A git submodule shared with another monorepo: the `@frediverse/*` packages and dev tooling. |
| `k7-core/` | The default module library, as plain files: modules, chains, assemblies, presets, impulse responses, amp models, samples, wavetables. |
| `docker/` | The production compose file and its `.env.example`. |
| `scripts/` | Root scripts behind the npm scripts: the dev session, the workspace runner, the custom lints, the remote-machine helpers. |
| `demos/` | Small `.k7` demo projects and a `_modules` folder used by them. |
| `.github/` | GitHub Actions workflows and the shared `node` composite action. |
| `.storybook/` | The repository's Storybook configuration. |
| `docs-site/` | This guide and the user guide. |

Root files worth knowing:

| File | Role |
|---|---|
| `package.json` | The workspace list, every root script, the shared dev dependencies, `engines.node >= 22.12.0`. |
| `.nvmrc` | The Node major CI, the image and the bundles share (`24`, `docs/images.md`). |
| `Tiltfile` | The dev session (see [Dev setup](./03-dev-setup.md)). |
| `biome.json` | Lint and format configuration, extending the base config in `commons`. |
| `knip.json` | Dead-code detection configuration. |
| `vitest.config.ts` | The root Vitest config, used when Vitest is run from the root. |
| `env.example.yaml` | Template for `env.yaml`, the per-machine service configuration (never committed). |
| `.onedev-buildspec.yml` | The OneDev CI pipeline (see [CI](./07-ci.md)). |
| `.gitattributes` | Forces LF line endings everywhere (`* text=auto eol=lf`) and marks audio, image and binary files as binary. |
| `.npmrc` | `legacy-peer-deps=true`. |

## The workspaces

The root `package.json` declares these workspace globs:

```json
"workspaces": [
  "commons/packages/*",
  "commons/dev/*",
  "packages/*",
  "apps/k7",
  "apps/k7/frontend",
  "apps/k7/backend",
  "apps/k7-standalone",
  "engine/k7-runtime",
  "engine/k7-android/web"
]
```

| Workspace | Package name | Notes |
|---|---|---|
| `apps/k7` | `k7` | An aggregator: its `dev` script runs the frontend and backend together with `concurrently`. |
| `apps/k7/frontend` | `k7-frontend` | React + Vite single-page app. |
| `apps/k7/backend` | `k7-backend` | Express server, run with `tsx` straight from `src/server.ts`. |
| `apps/k7-standalone` | `k7-standalone` | Electron desktop app. |
| `engine/k7-runtime` | `k7-runtime` | Not JavaScript: the workspace exists for its npm scripts (`dev`, `build:win`, `build:mac`, `build:android`, `test`, `test:all` and the `gen:*` generators). It declares no `build` script, so `npm run build` never compiles C++. |
| `engine/k7-android/web` | `@studio/k7-android-shell` | The Capacitor page of the Android app. |
| `packages/*` | `@studio/*` | The shared tier, below. |
| `commons/packages/*`, `commons/dev/*` | `@frediverse/*` | The submodule's packages, below. |

`engine/k7-supervisor` is a CMake project only and is not a workspace.

## `packages/`: raw TypeScript through `exports`

Every package under `packages/` is named `@studio/<folder>` and has no build step. A package's
`package.json` maps public subpaths straight to `.ts` source files:

```json
{
  "name": "@studio/engine-protocol",
  "type": "module",
  "exports": {
    ".": "./types.ts",
    "./project": "./project.ts",
    "./build": "./build.ts",
    "./sessions": "./sessions.ts",
    "./stream": "./stream.ts"
  }
}
```

Consequences of that choice:

- **Only listed subpaths are importable.** `import { x } from "@studio/song/loader"` works because
  `./loader` is in the map; a deep path such as `@studio/song/src/loader.ts` is refused by the
  resolver. Adding a public entry point means adding a line to `exports`.
- **Every consumer compiles the source.** The packages' `tsconfig.json` files use
  `"moduleResolution": "bundler"`, `"allowImportingTsExtensions": true` and `"noEmit": true`, so
  relative imports carry their `.ts` extension. The frontend's Vite build compiles them as part of
  the app; `apps/k7/frontend/vite.config.ts` excludes `@studio/ui-chains`, `@studio/ui-chains-react`,
  `@studio/ui-editor` and `@studio/ui-timeline` from dependency pre-bundling because esbuild's scanner
  rejects the `.ts` extension in their export maps.
- **Node processes run under `tsx`.** The backend (`apps/k7/backend/src/server.ts`) and the
  per-account file service (`packages/file-service/src/server.ts`) are started with `tsx`, which
  imports the TypeScript directly.
- **The production image ships the source.** `apps/k7/docker/Dockerfile` copies the whole repository
  into the runtime stage, because the `@studio/*` entries in `node_modules` are symlinks to source
  folders (see [Images and deployment](./08-images-and-deployment.md)).
- **A package's `build` script is a typecheck.** Most packages declare `"build": "tsc --noEmit"`;
  the exception is `@studio/dsp`, whose `build` runs `tsx src/emit.ts`.

One package is a process rather than a library: `@studio/file-service` declares
`"bin": { "studio-file-service": "./src/server.ts" }` and is spawned by `@studio/file-hub`, once per
account.

Four packages are published by version for consumers outside this repository: `web-protocol`,
`engine-protocol`, `engine-browser` and `project-shell` (see
[Releases and publishing](./09-releases-and-publishing.md)). Every other package is private to the tree.

### The packages by area

| Area | Packages |
|---|---|
| Song files and compile | `song-schema`, `song`, `song-edit`, `k7x`, `song-video`, `song-strudel`, `translator` |
| Commands | `commands` |
| Audio processing | `audio-analysis`, `audio-probe`, `audio-passes`, `take-render`, `dsp`, `stem-separation` |
| Engine connection | `engine-protocol`, `engine-client`, `engine-browser`, `engine-registry`, `engine-tunnel`, `supervisor-host` |
| Disk and sync | `file-service`, `file-hub`, `live-sync`, `user-prefs` |
| Media library | `mediatek`, `mpv-player`, `ui-library`, `ui-mini-player` |
| App shell and views | `project-shell`, `ui-chains`, `ui-chains-react`, `ui-editor`, `ui-eyes`, `ui-timeline`, `ui-waveform`, `ui-module-builder`, `ui-user-menu` |
| Shared types | `web-protocol`, `graph-model` |
| Plugin contract | `k7-sdk`, `k7-plugins` |
| Rehearsal recorder | `rehearsal-server`, `rehearsal-shared`, `ui-rehearsal`, `recorder`, `score`, `lyrics`, `tablature` |

Each area has its own section in this guide; the package's own `package.json` description and its
`exports` map are the quickest way to see what it offers.

## `engine/`

| Folder | Build system | Output |
|---|---|---|
| `engine/k7-runtime` | CMake (`CMakePresets.json`: `macos-clang`, `windows-msvc`, `windows-msvc-ninja`, `dev-gcc`, `release-gcc`, `android-arm64` and others) | The `k7-runtime` executable (or `libk7runtime.so` on Android) |
| `engine/k7-supervisor` | CMake, its own presets | The `k7-supervisor` executable and its unit-test binary |
| `engine/k7-android` | Gradle (`./gradlew assembleDebug`) | The Android APK, which builds its own arm64 engine and supervisor |
| `engine/scripts` | Node | `build-engine.mjs` (build and stage the command-line engine into `dist/k7-runtime/`), `package-release.mjs` (archive it, or rename the desktop installer), `devEngine.mjs` and `supervisorBuild.mjs` (used by the dev session) |
| `engine/docker` | Docker | The server engine's image (`Dockerfile`, `entrypoint.sh`, `asound.conf`) |

The engine section of this guide covers the C++ code itself.

## `commons/`: the shared submodule

`commons` is a git submodule (`.gitmodules` points at `../commons.git`, branch `main`) shared with a
second monorepo. It provides:

| Package | Used for |
|---|---|
| `@frediverse/ui` | The design-system components and the one icon set (`@frediverse/ui/icons`). |
| `@frediverse/oidc` | `setupAuth()`, the OIDC login and the `studio.sid` session the backend mints. |
| `@frediverse/http` | Express helpers (precompressed static files, proxy awareness, route validation). |
| `@frediverse/i18n` | The Paraglide wrapper the frontend compiles its catalogues with. |
| `@frediverse/electron-shell` | The Electron base the desktop app is built on. |
| `@frediverse/env` | `loadServiceEnv()`, which reads a service's section of `env.yaml`. |
| `@frediverse/vite-config` | `defineAppConfig()`, the shared Vite config (ports, proxy, PWA, Tailwind). |
| `@frediverse/tsconfig`, `@frediverse/api-client`, `@frediverse/docker-runtime`, `@frediverse/db-grist` | Shared TS config, API client, base runtime image, Grist client. |

The submodule also carries `biome.base.json`, which the root `biome.json` extends, and the scripts
behind `npm run images` and `npm run check-images`.

Working with it:

```bash
git submodule update --init          # first checkout: lint, install and build all need it
npm run commons:sync                 # pull the submodule's main and merge
```

A change under `commons/` is committed twice: once inside the submodule, then the new submodule
pointer in this repository. CI
checks `commons` out separately at the commit this repository pins (it is a private repository,
read with the `COMMONS_TOKEN` secret).

## `k7-core/`: the default library

`k7-core/` is the module library a new origin, desktop or phone starts from. Its folders
are `modules/`, `chains/`, `assemblies/`, `presets/`, `irs/`, `models/`, `samples/` and
`wavetables/`; the binaries in it are ordinary tracked files.

It is consumed in three ways:

- **The server** copies a library listed by an origin but missing on disk from
  `$STUDIO_LIBRARY_SEED` (`packages/file-hub/libraries.ts`), which can name `k7-core`.
- **The desktop and phone bundles** carry a copy: `apps/k7/backend/scripts/bundle.mjs` writes one
  into the bundle, and the desktop app copies from the repository's `k7-core` when it runs unpackaged.
- **Lints** read it: `npm run lint:layouts` and `npm run lint:panels` check its module panels.

`biome.json` excludes `k7-core` from linting. The Windows CI jobs set `core.longpaths`, but keep
paths inside it short anyway: a default Windows checkout refuses paths over 260 characters.
