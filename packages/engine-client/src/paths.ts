// paths.ts — the single definition of the state directory's layout, which the C++ engine,
// the file service, the supervisor and the desktop app all read or write by name. Where the
// directory IS: @studio/song's studioHome.ts. USE THESE, never a hand-joined path: a wrong
// path doesn't throw, it reads as an empty file, so a second spelling diverges silently.
// See docs/paths.md.

import { join } from "node:path";
import { EXTS_PATH } from "@studio/song/engineCatalogue";
import { mediatekRoot } from "@studio/song/mediatekRoot";
import { studioHome } from "@studio/song/studioHome";

/** The state dir — `<library>/st0`, or `$STUDIO_HOME` when set. */
export function studioDir(): string {
  return studioHome();
}

/** The engine's stable local identity, `{ id, token, createdAt }`. */
export function engineIdPath(): string {
  return join(studioDir(), "engine-id.json");
}

/** The running engine's pid — the one-engine-per-machine guard, and what lets a fresh supervisor re-adopt an orphaned engine. */
export function enginePidPath(): string {
  return join(studioDir(), "engine.pid");
}

/** An email as `_`-separated; it names the SSH key dir and the SESSION, no longer a workspace root — docs/paths.md. */
export function slugify(email: string): string {
  return email.replace(/[^a-zA-Z0-9]/g, "_");
}

/** The running SUPERVISOR's pid — one per machine, or two would fight over one engine (docs/supervisorPolicy.md). */
export function hostPidPath(): string {
  return join(studioDir(), "engine-host.pid");
}

/** One file per hosted SERVICE, a directory rather than one list because three backends booting together would lose an entry from it. Read for pl8's address by the file service (`mediatekLink.ts`); the supervisor does NOT connect the engine to what is here. */
export function webEndpointsDir(): string {
  return join(studioDir(), "web-endpoints");
}

/** The supervisor's own settings — where they are WRITTEN, and what pairs with `engine-host.pid`. */
export function settingsPath(): string {
  return join(studioDir(), "engine-host.json");
}

/**
 * Where to READ them from. One name now: `engine-tray.json` was read here until the tray it was
 * named after stopped existing, and a machine still carrying only that one starts from defaults —
 * see docs/paths.md for what that costs and why it is the whole of the migration.
 */
export function existingSettingsPath(): string {
  return settingsPath();
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

/** The engine log written when NOT under the supervisor; its name follows the directory around it, so it is never looked for under another. */
export function engineLogPath(): string {
  return join(studioDir(), ".studio-engine.log");
}

/** The MERGED log — the engine's and the file service's output, interleaved and tagged; what "Show logs" opens and the Logs panel reads. */
export function mergedLogPath(): string {
  return join(studioDir(), ".studio.log");
}

/** `<state>/workspace` — the workspaces the file service owns, one level, no user beneath it. */
export function rootDir(): string {
  return join(studioDir(), "workspace");
}

/** `<state>/mediatek` — the media library, overridable via `$STUDIO_MEDIATEK`; `@studio/song` owns the spelling. */
export function mediatekDir(): string {
  return mediatekRoot();
}

/** Per-person SSH keys, `<state>/ssh/<slug>`, written by the file service so a workspace can talk to a git remote as itself. */
export function sshDir(slug: string): string {
  return join(studioDir(), "ssh", slug);
}
