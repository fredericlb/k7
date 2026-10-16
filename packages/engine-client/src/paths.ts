// paths.ts — the single definition of the state directory's layout, which the C++ engine,
// the file service, the supervisor and the desktop app all read or write by name. Where the
// directory IS: @studio/song's studioHome.ts. USE THESE, never a hand-joined path: a wrong
// path doesn't throw, it reads as an empty file, so a second spelling diverges silently.
// See docs/paths.md.

import { join } from "node:path";
import { mediatekRoot } from "@studio/song/mediatekRoot";
import { studioHome } from "@studio/song/studioHome";

/** The state dir — `<library>/k7`, or `$STUDIO_HOME` when set. */
export function studioDir(): string {
  return studioHome();
}

/** An email as `_`-separated; it names the SSH key dir and the SESSION, no longer a workspace root — docs/paths.md. */
export function slugify(email: string): string {
  return email.replace(/[^a-zA-Z0-9]/g, "_");
}

/** One file per hosted SERVICE, a directory rather than one list because three backends booting together would lose an entry from it. Read for pl8's address by the file service (`mediatekLink.ts`); the supervisor does NOT connect the engine to what is here. */
export function webEndpointsDir(): string {
  return join(studioDir(), "web-endpoints");
}

/** `<state>/workspace` — the workspaces the file service owns, one level, no user beneath it. */
export function rootDir(): string {
  return join(studioDir(), "workspace");
}

/** `<state>/mediatek` — the media library, overridable via `$STUDIO_MEDIATEK`; `@studio/song` owns the spelling. */
export function mediatekDir(): string {
  return mediatekRoot();
}
