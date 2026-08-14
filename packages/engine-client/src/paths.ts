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

/** The running engine's pid. The one-engine-per-machine guard, and what lets a fresh
 *  supervisor re-adopt an engine whose supervisor was force-killed. */
export function enginePidPath(): string {
  return join(studioDir(), "engine.pid");
}

/** Written by the web backend on boot; `.url` is the registry a local dev setup should
 *  win with over the hosted default. Superseded by `webEndpointsDir` — still READ, so an
 *  older backend, or a file one left behind, keeps working. */
export function webEndpointPath(): string {
  return join(studioDir(), "web-endpoint.json");
}

/**
 * One file per hosted SERVICE, each holding that service's registry URL.
 *
 * A directory and not one shared file, because there are three services now and they boot
 * together under `npm run dev`: a read-modify-write on a single list would lose an entry to
 * whichever backend wrote last, and losing an entry is exactly the failure this replaces —
 * an engine listed in one app's picker and missing from another's.
 */
export function webEndpointsDir(): string {
  return join(studioDir(), "web-endpoints");
}

/** The supervisor's own settings (registry override, ports, audio picks).
 *
 * Keeps the name `engine-tray.json` even though the tray no longer writes it AND is no
 * longer called that — it is `studio-capot` now. The directory around it moved from
 * `~/.lanes` to `~/.studio` as a clean break, with no read-old/write-new step: everyone
 * renames the directory once and every file inside it is found again under its own name.
 * Renaming this FILE too would break that — the one move would stop being one move. */
export function settingsPath(): string {
  return join(studioDir(), "engine-tray.json");
}

/** The plugin scan cache. Deleted before a forced rescan so the engine re-discovers
 *  everything. Contract path — the C++ engine writes and reads this same file (see
 *  engine/engine/PluginScan.cpp `extsCacheFile()`).
 *
 *  The ONE entry defined elsewhere: `@studio/song` reads this cache as its engine module
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
  return join(studioDir(), "web-origins.json");
}

/** Origins the file service refused, waiting to be allowed or dismissed. Written by
 *  packages/file-service/src/pendingOrigins.ts. */
export function pendingOriginsPath(): string {
  return join(studioDir(), "pending-origins.json");
}

/** The engine log written when NOT under the supervisor (the CLI path).
 *
 *  Renamed with the directory around it, in the same move, which is the whole reason it
 *  could be renamed at all: the file service falls back to READING this when there is no
 *  merged log, so a rename on its own would have made an existing log stop being found.
 *  Moving both at once means neither is ever looked for under the wrong name. */
export function engineLogPath(): string {
  return join(studioDir(), ".studio-engine.log");
}

/** The old separate file-service log (pre-merge). No longer written; kept as a name. */
export function fileServiceLogPath(): string {
  return join(studioDir(), ".studio-file-service.log");
}

/** The MERGED log: the engine's and the file service's output, interleaved and tagged.
 *  This is what "Show logs" opens and what the file service serves to the web UI's Logs
 *  panel — one place for everything the engine side says. */
export function mergedLogPath(): string {
  return join(studioDir(), ".studio.log");
}

/** `~/.studio/root` — the per-user workspaces root the file service owns. */
export function rootDir(): string {
  return join(studioDir(), "root");
}

/** `~/.studio/mediatek` — the media library: songs, samples and modules.
 *
 *  Per MACHINE, not per user, unlike `rootDir()`: it is the one place a l8 song, a
 *  k7 release and an z0 track can be the same thing, which a per-user split
 *  would undo. Overridable via `$STUDIO_MEDIATEK` because it holds audio and video and
 *  will not always belong on the system drive — the supervisor passes it down from its
 *  settings, the same way it passes the ports.
 *
 *  The SECOND entry defined elsewhere, for the same reason as `extsCachePath` above:
 *  `@studio/song` resolves a project's `@st0` reference to it and cannot import this
 *  package, so song owns the spelling and this delegates. */
export function mediatekDir(): string {
  return mediatekRoot();
}

/** Per-workspace SSH keys, `~/.studio/ssh/<slug>`. Written by the file service so a
 *  workspace can talk to a git remote as itself. */
export function sshDir(slug: string): string {
  return join(studioDir(), "ssh", slug);
}
