// Re-export the API contract so app code imports types from one place. Two packages
// now: the chains graph is shared with every app that draws one, the rest is st0'.
export * from "@studio/graph-model";
export * from "@studio/web-protocol";

import type { RankedEngine as Ranked } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";

/** A probed engine carrying the registry's full record. The probe is generic over what an
 *  engine IS — it needs an id and some addresses — so st0 names its own flavour here. */
export type RankedEngine = Ranked<PublicEngine>;

/**
 * One row of `GET /playlists` — a `.yaml` under the workspace's `_playlists/`.
 *
 * `title` and `count` are read by PARSING the file on the service's side, which is the whole of
 * what a row needs to draw. `ok: false` is a file that does NOT parse: still listed, because it
 * is on the disk and a listing that hid it would leave you unable to click the thing you have to
 * go and repair. See @studio/song/docs/playlists.md.
 */
export interface PlaylistInfo {
  /** Workspace-relative, so it is already what `read`/`write` take. */
  path: string;
  /** The file's stem — what the row falls back to, and what a rename would change. */
  name: string;
  title?: string;
  count: number;
  ok: boolean;
}
