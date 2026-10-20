// paths.ts — where the app finds its code and binaries, and where it keeps its state.
// Unpackaged, everything comes from the checkout; packaged, from what scripts/stage.mjs put in Resources — the backend as a BUNDLE.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import standalone from "../../k7/backend/standalone.json";

const exe = (name: string): string =>
  process.platform === "win32" ? `${name}.exe` : name;

/** The checkout this unpackaged run lives in: the first parent whose package.json is the monorepo's. */
function repoRoot(): string {
  let dir = __dirname;
  for (;;) {
    const pkg = join(dir, "package.json");
    if (
      existsSync(pkg) &&
      JSON.parse(readFileSync(pkg, "utf8")).name === "studio"
    )
      return dir;
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error(`no studio checkout above ${__dirname}`);
    dir = parent;
  }
}

/** The checkout this unpackaged run lives in, whose source the backend runs from under tsx. */
export function sourceRoot(): string {
  return repoRoot();
}

/** The bundled backend's tree (apps/k7/backend/scripts/bundle.mjs) when packaged; null runs the checkout's source. */
export function backendBundle(): string | null {
  return app.isPackaged ? join(process.resourcesPath, "backend") : null;
}

/** k7's own mark, the same file electron-builder turns into the bundle's icon. */
export function appIcon(): string {
  const frontend = join(
    backendBundle() ?? repoRoot(),
    "apps",
    "k7",
    "frontend",
  );
  return app.isPackaged
    ? join(frontend, "dist", "icon-desktop.png")
    : join(frontend, "public", "icon-desktop.png");
}

// A multi-config generator (MSVC) nests the binary one folder deeper, as engine/scripts/supervisorBuild.mjs knows.
const CONFIGS = ["", "Release", "RelWithDebInfo", "Debug"];

/** The newest build of a CMake target under `<project>/build/<preset>/[<config>/]`, Debug last, or null. */
function newestBuild(project: string, name: string): string | null {
  const build = join(repoRoot(), "engine", project, "build");
  if (!existsSync(build)) return null;
  const found = readdirSync(build)
    // A phone's preset (android-*, ios-*) builds a binary this desktop cannot run.
    .filter((preset) => !/^(android|ios)-/.test(preset))
    .flatMap((preset) =>
      CONFIGS.map((cfg) => ({
        path: join(build, preset, cfg, exe(name)),
        debug: cfg === "Debug",
      })),
    )
    .filter((c) => existsSync(c.path) && statSync(c.path).isFile());
  found.sort(
    (a, b) =>
      Number(a.debug) - Number(b.debug) ||
      statSync(b.path).mtimeMs - statSync(a.path).mtimeMs,
  );
  return found[0]?.path ?? null;
}

/** The supervisor binary; it finds the engine beside itself (packaged) or in the checkout's build. */
export function supervisorBinary(): string | null {
  if (app.isPackaged)
    return join(process.resourcesPath, "bin", exe("k7-supervisor"));
  return newestBuild("k7-supervisor", "k7-supervisor");
}

/** The engine binary, handed to the backend as `$STUDIO_ENGINE` for its offline renders. */
export function engineBinary(): string | null {
  if (app.isPackaged)
    return join(process.resourcesPath, "bin", exe("k7-runtime"));
  return newestBuild("k7-runtime", "k7-runtime");
}

/** The folder the `k7-core` library is first copied from: the bundle's copy when packaged, the submodule otherwise. */
export function librarySource(): string | null {
  const bundle = backendBundle();
  const at = bundle
    ? join(bundle, standalone.library)
    : join(repoRoot(), "k7-core");
  return existsSync(at) ? at : null;
}

/** Everything the app writes, under the OS's per-app folder — never `~/.k7`, which the command-line engine owns. */
export function stateDirs() {
  const root = app.getPath("userData");
  return {
    root,
    // The backend's folders, named once for the desktop and the phone (apps/k7/backend/standalone.json).
    backend: Object.fromEntries(
      Object.entries(standalone.dirs).map(([k, rel]) => [k, join(root, rel)]),
    ),
    files: join(root, standalone.dirs.STUDIO_FILES_ROOT),
    engineHome: join(root, "engine-home"),
    log: join(root, "standalone.log"),
  };
}
