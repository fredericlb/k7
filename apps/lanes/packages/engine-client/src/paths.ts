// paths.ts — the single definition of the shared ~/.lanes/ layout, which the C++
// engine, the file service, the supervisor and the web backend all read or write by name.
// USE THESE, never a hand-joined path: a wrong path doesn't throw, it reads as an empty
// file, so a second spelling diverges silently.

import { homedir } from "node:os";
import { join } from "node:path";
import { EXTS_PATH } from "@lanes/song/engineCatalogue";

/** `~/.lanes` — the shared state dir. */
export function lanesDir(): string {
  return join(homedir(), ".lanes");
}

/** The engine's stable local identity, `{ id, token, createdAt }`. */
export function engineIdPath(): string {
  return join(lanesDir(), "engine-id.json");
}

/** The running engine's pid. The one-engine-per-machine guard, and what lets a fresh
 *  supervisor re-adopt an engine whose supervisor was force-killed. */
export function enginePidPath(): string {
  return join(lanesDir(), "engine.pid");
}

/** Written by the web backend on boot; `.url` is the registry a local dev setup should
 *  win with over the hosted default. */
export function webEndpointPath(): string {
  return join(lanesDir(), "web-endpoint.json");
}

/** The supervisor's own settings (registry override, ports, audio picks).
 *
 * Keeps the name `engine-tray.json` even though the tray no longer writes it: renaming
 * it would silently discard every existing user's audio-device pick and registry
 * override. If it is ever renamed that must be its own change, read-old/write-new. */
export function settingsPath(): string {
  return join(lanesDir(), "engine-tray.json");
}

/** The plugin scan cache. Deleted before a forced rescan so the engine re-discovers
 *  everything. Contract path — the C++ engine writes and reads this same file (see
 *  engine/engine/PluginScan.cpp `extsCacheFile()`).
 *
 *  The ONE entry defined elsewhere: `@lanes/song` reads this cache as its engine module
 *  catalogue, and song cannot import this package (engine-client depends on song, not the
 *  other way round). So song owns the constant and this delegates — which is the rule this
 *  file states, applied in the only direction the dependency graph allows. */
export function extsCachePath(): string {
  return EXTS_PATH;
}

/** The web UIs the user has allowed to reach this engine. Written by the supervisor,
 *  read by the file service's CORS policy on EVERY request — which is what makes
 *  adding a web UI take effect with nothing restarted. */
export function webOriginsPath(): string {
  return join(lanesDir(), "web-origins.json");
}

/** Origins the file service refused, waiting to be allowed or dismissed. Written by
 *  packages/file-service/src/pendingOrigins.ts. */
export function pendingOriginsPath(): string {
  return join(lanesDir(), "pending-origins.json");
}

/** The engine log written when NOT under the supervisor (the CLI path). Kept as a
 *  contract name; the file service falls back to reading it when there is no merged log. */
export function engineLogPath(): string {
  return join(lanesDir(), ".lanes-engine.log");
}

/** The old separate file-service log (pre-merge). No longer written; kept as a name. */
export function fileServiceLogPath(): string {
  return join(lanesDir(), ".lanes-file-service.log");
}

/** The MERGED log: the engine's and the file service's output, interleaved and tagged.
 *  This is what "Show logs" opens and what the file service serves to the web UI's Logs
 *  panel — one place for everything the engine side says. */
export function mergedLogPath(): string {
  return join(lanesDir(), ".lanes.log");
}

/** `~/.lanes/root` — the per-user workspaces root the file service owns. */
export function rootDir(): string {
  return join(lanesDir(), "root");
}

/** Per-workspace SSH keys, `~/.lanes/ssh/<slug>`. Written by the file service so a
 *  workspace can talk to a git remote as itself. */
export function sshDir(slug: string): string {
  return join(lanesDir(), "ssh", slug);
}
