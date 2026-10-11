// paths.ts — where the app finds its code and binaries, and where it keeps its state.
// Unpackaged, everything comes from the checkout; packaged, from what scripts/stage.mjs put in Resources.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

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

/** The tree holding apps/, packages/ and node_modules: the checkout, or the staged copy of it. */
export function sourceRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, "app-src") : repoRoot();
}

/** st0's own mark, the same file electron-builder turns into the bundle's icon. */
export function appIcon(): string {
  return join(
    sourceRoot(),
    "apps",
    "st0",
    "frontend",
    "public",
    "icon-512.png",
  );
}

/** The newest build of a CMake target under `<project>/build/<preset>/`, or null. */
function newestBuild(project: string, name: string): string | null {
  const build = join(repoRoot(), "engine", project, "build");
  if (!existsSync(build)) return null;
  const found = readdirSync(build)
    .map((preset) => join(build, preset, exe(name)))
    .filter((p) => existsSync(p));
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? null;
}

/** The supervisor binary; it finds the engine beside itself (packaged) or in the checkout's build. */
export function supervisorBinary(): string | null {
  if (app.isPackaged)
    return join(process.resourcesPath, "bin", exe("st0-supervisor"));
  return newestBuild("st0-supervisor", "st0-supervisor");
}

/** The engine binary, handed to the backends as `$STUDIO_ENGINE` for their offline renders. */
export function engineBinary(): string | null {
  if (app.isPackaged)
    return join(process.resourcesPath, "bin", exe("st0-engine"));
  return newestBuild("st0-engine", "st0-engine");
}

/** The git repository the `st0` library is cloned from: a bare copy when packaged, the submodule otherwise. */
export function librarySource(): string | null {
  const at = app.isPackaged
    ? join(process.resourcesPath, "st0-library.git")
    : join(repoRoot(), "st0-library");
  return existsSync(at) ? at : null;
}

/** Everything the app writes, under the OS's per-app folder — never `~/.st0`, which the tray owns. */
export function stateDirs() {
  const root = app.getPath("userData");
  return {
    root,
    files: join(root, "workspaces"),
    mediatek: join(root, "mediatek"),
    prefs: join(root, "prefs"),
    serverHome: join(root, "server-home"),
    engineHome: join(root, "engine-home"),
    log: join(root, "standalone.log"),
  };
}
