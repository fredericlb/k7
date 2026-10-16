// playlists.ts — the reply of a file service's `GET /playlists`: the workspace's `_playlists/` files,
// one row each. A row with `ok: false` is still listed, being on the disk. See packages/song/docs/playlists.md.

/** One row of `GET /playlists` — `title` and `count` are parsed service-side. */
export interface PlaylistInfo {
  /** Workspace-relative, so it is already what `read`/`write` take. */
  path: string;
  /** The file's stem — what the row falls back to, and what a rename would change. */
  name: string;
  title?: string;
  count: number;
  ok: boolean;
}
