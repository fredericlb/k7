// paths.ts — the single definition of the shared ~/.studio/ layout, which the C++
// engine, the file service, the supervisor and the web backend all read or write by name.
// USE THESE, never a hand-joined path: a wrong path doesn't throw, it reads as an empty
// file, so a second spelling diverges silently.

import { homedir } from "node:os";
import { join } from "node:path";
import { EXTS_PATH } from "@studio/song/engineCatalogue";
import { mediatekRoot } from "@studio/song/mediatekRoot";

/** `~/.studio` — the shared state dir. */
export function studioDir(): string {
  return join(homedir(), ".studio");
}

/** The engine's stable local identity, `{ id, token, createdAt }`. */
export function engineIdPath(): string {
  return join(studioDir(), "engine-id.json");
}

/** The running engine's pid — the one-engine-per-machine guard, and what lets a fresh supervisor re-adopt an orphaned engine. */
export function enginePidPath(): string {
  return join(studioDir(), "engine.pid");
}

/** Written by the web backend on boot, superseded by `webEndpointsDir` but still READ, so an older backend keeps working. */
export function webEndpointPath(): string {
  return join(studioDir(), "web-endpoint.json");
}

/** One file per hosted SERVICE, a directory rather than one list because three backends booting together would lose an entry from it. */
export function webEndpointsDir(): string {
  return join(studioDir(), "web-endpoints");
}

/** The supervisor's own settings; it keeps the name `engine-tray.json` so that moving `~/.lanes` to `~/.studio` stayed exactly ONE move. */
export function settingsPath(): string {
  return join(studioDir(), "engine-tray.json");
}

/** The plugin scan cache, deleted before a forced rescan; a contract path the C++ engine reads and writes, and `@studio/song` owns the constant. */
export function extsCachePath(): string {
  return EXTS_PATH;
}

/** The web UIs the user has allowed, read by the file service's CORS policy on EVERY request, which is what makes adding one take effect at once. */
export function webOriginsPath(): string {
  return join(studioDir(), "web-origins.json");
}

/** Origins the file service refused, waiting to be allowed or dismissed; written by packages/file-service/src/pendingOrigins.ts. */
export function pendingOriginsPath(): string {
  return join(studioDir(), "pending-origins.json");
}

/** The engine log written when NOT under the supervisor, renamed with the directory around it so it is never looked for under the wrong name. */
export function engineLogPath(): string {
  return join(studioDir(), ".studio-engine.log");
}

/** The MERGED log — the engine's and the file service's output, interleaved and tagged; what "Show logs" opens and the Logs panel reads. */
export function mergedLogPath(): string {
  return join(studioDir(), ".studio.log");
}

/** `~/.studio/root` — the per-user workspaces root the file service owns. */
export function rootDir(): string {
  return join(studioDir(), "root");
}

/** `~/.studio/mediatek` — the media library, per MACHINE rather than per user and overridable via `$STUDIO_MEDIATEK`; `@studio/song` owns the spelling. */
export function mediatekDir(): string {
  return mediatekRoot();
}

/** Per-workspace SSH keys, `~/.studio/ssh/<slug>`, written by the file service so a workspace can talk to a git remote as itself. */
export function sshDir(slug: string): string {
  return join(studioDir(), "ssh", slug);
}
