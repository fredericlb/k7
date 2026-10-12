// paths.ts — the few `<state>` paths the tray touches itself, and where the supervisor and the settings page live.
// `<state>` mirrors packages/engine-client/src/paths.ts BY HAND: a second spelling is a pidfile nobody reads.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { app } from "electron";

const exe = (name: string): string =>
  process.platform === "win32" ? `${name}.exe` : name;

/** `<state>`: `$STUDIO_HOME`, else `~/.st0` on every platform (packages/engine-client/docs/paths.md). */
export function studioDir(): string {
  const home = process.env.STUDIO_HOME;
  return home ? home : join(homedir(), ".st0");
}

export function enginePidPath(): string {
  return join(studioDir(), "engine.pid");
}

/** Written by the supervisor; the tray truncates it once per session and adds the `[host]` lines. */
export function mergedLogPath(): string {
  return join(studioDir(), ".studio.log");
}

/** The checkout this unpackaged run lives in: `$STUDIO_REPO_ROOT`, else the first parent holding `engine/st0-engine`. */
function repoRoot(): string | null {
  const env = process.env.STUDIO_REPO_ROOT;
  if (env && existsSync(env)) return env;
  for (let dir = __dirname; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "engine", "st0-engine"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** The freshest build under engine/st0-supervisor/build, a Debug one only when nothing else is there. */
function supervisorFromRepo(): string | null {
  const root = repoRoot();
  if (!root) return null;
  const build = join(root, "engine", "st0-supervisor", "build");
  if (!existsSync(build)) return null;
  const found: { debug: boolean; at: number; path: string }[] = [];
  for (const preset of readdirSync(build))
    for (const cfg of ["", "Release", "RelWithDebInfo", "Debug"]) {
      const path = join(build, preset, cfg, exe("st0-supervisor"));
      if (existsSync(path) && statSync(path).isFile())
        found.push({
          debug: cfg === "Debug",
          at: statSync(path).mtimeMs,
          path,
        });
    }
  found.sort((a, b) => Number(a.debug) - Number(b.debug) || b.at - a.at);
  return found[0]?.path ?? null;
}

/** `$STUDIO_ENGINE_HOST_CMD`, the packaged copy, or the repo's newest build; null is a LOUD "not found". */
export function supervisorBinary(): string | null {
  const env = process.env.STUDIO_ENGINE_HOST_CMD;
  if (env && existsSync(env)) return env;
  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, "bin", exe("st0-supervisor"));
    return existsSync(packaged) ? packaged : null;
  }
  return supervisorFromRepo();
}

/** The settings window's hand-written page: staged into Resources, or `settings/` beside `dist/` in a checkout. */
export function settingsPage(): string {
  if (app.isPackaged)
    return join(process.resourcesPath, "settings", "settings.html");
  return join(__dirname, "..", "settings", "settings.html");
}
