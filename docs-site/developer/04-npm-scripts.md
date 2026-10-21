# Root npm scripts

Every script in the root `package.json`, grouped by purpose. Run them from the repository root.

## Session and apps

| Script | Runs | Purpose |
|---|---|---|
| `dev` | `node scripts/dev.mjs` | The dev session under Tilt. Extra arguments go to `tilt up` (`npm run dev -- k7-backend`). See [Dev setup](./03-dev-setup.md). |
| `dev:tray` | `node scripts/dev-tray.mjs` | The engine, supervisor and tray build-run-watch loop on its own, outside Tilt. |
| `storybook` | `storybook dev -p 6006` | Storybook for components under `packages/*/src` and `apps/*/frontend/src`. |
| `build-storybook` | `storybook build` | Static Storybook into `storybook-static/`. |

## Build, typecheck, test

| Script | Runs | Purpose |
|---|---|---|
| `build` | `npm run build --workspaces --if-present` | Every workspace's `build`. For most packages that is `tsc --noEmit`; for `k7-frontend` it is `vite build && tsc --noEmit`; for `@studio/dsp` it runs its emitter. `k7-runtime` has no `build`, so this never compiles C++. |
| `typecheck` | `node scripts/workspaces.mjs typecheck` | Every workspace's `typecheck` script. Accepts `--jobs N` (`npm run typecheck -- --jobs 2`). |
| `test` | `node scripts/workspaces.mjs test` | Every workspace's `test` script. Accepts `--jobs N`. See [Tests](./05-tests.md). |
| `engine:build` | `node engine/scripts/build-engine.mjs` | Builds the C++ engine and the supervisor in this platform's preset (`macos-clang`, `windows-msvc`, otherwise `release-gcc`; `STUDIO_ENGINE_PRESET` and `STUDIO_SUPERVISOR_PRESET` override it) and stages the command-line engine into `dist/k7-runtime/`. |

## Lints

| Script | Runs | Blocking? |
|---|---|---|
| `lint` | `biome check .` | Yes (GitHub `k7` `lint` job, OneDev). |
| `lint:fix` | `biome check --write .` | Applies Biome's safe fixes and formatting. |
| `lint:bytes` | `node scripts/check-source-bytes.mjs` | Yes (GitHub `k7` `lint` job, OneDev). |
| `lint:docs` | `node scripts/check-doc-links.mjs` | No: run it before pushing. |
| `lint:comments` | `node scripts/check-comments.mjs` | No: reports a backlog. |
| `lint:version` | `node scripts/check-version.mjs` | Yes (GitHub `k7` `lint` job). Every private workspace carries the root `package.json`'s version; `--set X.Y.Z` writes every copy, `--tag vX.Y.Z` also checks a release tag. |
| `lint:dead` | `knip` | No: reports a backlog. |
| `lint:panels` | `tsx packages/song/scripts/checkPanelBinds.ts` | No: needs the external plugins installed on the machine. |
| `lint:layouts` | `tsx packages/ui-module-builder/scripts/checkLayouts.ts` | No: run by hand after editing module panels. |

Each is described in [Lints and conventions](./06-lints-and-conventions.md).

## Images

| Script | Runs | Purpose |
|---|---|---|
| `images` | `build-images.sh` from the `commons` submodule's `scripts/` folder | Local image build and push, from the repository root. Builds the commons base image, then every `apps/*/docker/Dockerfile` (today only `apps/k7`), tags `:latest` and an `rN` revision that only moves when the image ID changes (tracked in a gitignored `.docker-revision.<app>` file), and pushes to `$REGISTRY` (default `dev.frediver.se/frediverse`) under `<repo folder name>/<app>`. `PLATFORM` defaults to `linux/amd64`. The CI images are built differently: see [Images and deployment](./08-images-and-deployment.md). |
| `check-images` | `check-image-closure.cjs` from the same folder | Runs `turbo prune` per backend and checks that each pruned tree contains every workspace package that backend imports transitively, since a missing one is a dangling symlink in an image. Needs `turbo` available. |

## Configuration and maintenance

| Script | Runs | Purpose |
|---|---|---|
| `tokens` | `node scripts/tokens.mjs` | Writes a random `API_TOKEN_SECRET` into the `k7-backend` section of `env.yaml`, preserving the file's comments. `--dry-run` prints without writing; `--env <file>` targets another file. Fails if `env.yaml` does not exist. |
| `commons:sync` | `git submodule update --remote --merge commons` | Moves the `commons` submodule to its upstream `main`. |
| `clean` | `rm -rf …/node_modules` | Deletes every `node_modules` folder in the tree (root, commons, packages, apps). |

## Remote dev box (Windows)

| Script | Runs | Purpose |
|---|---|---|
| `vscode` | `node scripts/vscode.mjs` | VS Code in the browser on port 8798. |
| `console` | `node scripts/console/server.mjs` (after installing its own dependencies) | Shared terminal tabs on port 8797. |
| `remote:install`, `remote:uninstall`, `remote:status` | `node scripts/remote.mjs …` | Windows logon tasks that keep `vscode` and `console` running. |

## Workspace scripts worth knowing

These are run with `--workspace <name>`:

| Workspace | Script | Purpose |
|---|---|---|
| `k7-runtime` | `build:mac`, `build:win`, `build:android` | Engine build in the `macos-clang`, `windows-msvc` or `android-arm64` preset, through `engine/k7-runtime/scripts/build.mjs`. |
| `k7-runtime` | `test`, `test:all` | Builds and runs the C++ `studio_*` test targets; `test:all` adds the slow Tracktion-linked ones. |
| `k7-runtime` | `gen:builtin-params` | Regenerates `packages/song-schema/src/builtinParams.generated.json` from a real engine, one plugin per line. |
| `k7-runtime` | `gen:strudel-bundle`, `gen:surge-panel` | Regenerate committed generated files (the pattern-lane bundle the engine embeds; the Surge XT module's panel in `k7-core`). |
| `k7-tray` | `stage` | Stages the frontend and the backend bundle, the engine binaries and a pinned node into `apps/k7-tray/src-tauri/resources/`. |
| `k7-tray` | `dev`, `build` | `tauri dev`; `tauri build`, the installers. |
| `k7-backend` | `start` | The backend without file watching. |
| `@studio/file-service` | `start`, `bench` | Runs the file service alone; runs its Vitest benchmarks. |
| `@studio/song` | `bench` | Vitest benchmarks of the compile. |
| `@studio/mediatek` | `upload-library` | `scripts/uploadLibrary.ts` under Node's type stripping. |
| `@studio/ui-rehearsal` | `i18n` | Compiles the rehearsal screens' Paraglide catalogue; runs before its `typecheck` and `test`. |
