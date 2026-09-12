// copyProject.ts — copying a project from one workspace into another on this machine. Its own
// module because it is the one act naming TWO workspaces: neither Workspace instance owns it,
// and each end still answers for its own guards. See docs/workspaces.md.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectSurfaces } from "@studio/song/surfaces";
import { playlistPathOf } from "@studio/song-schema/playlist";
import { slugify } from "./slug.ts";
import { forgetListing, getWorkspace } from "./workspaces.ts";

/**
 * The playlists the copy NAMES, carried across with it. A `turntables` surface names one by name,
 * and the file lives at the WORKSPACE root — so a project copied on its own lands beside no set
 * list and opens on "the playlist this surface names cannot be found". One already there is left
 * alone: the destination's own set list wins over the source's.
 */
function carryPlaylists(
  srcRoot: string,
  destRoot: string,
  projectAbs: string,
): string[] {
  const carried: string[] = [];
  for (const { surface } of projectSurfaces(projectAbs).surfaces) {
    const rel = surface.playlist ? playlistPathOf(surface.playlist) : null;
    if (!rel || existsSync(join(destRoot, rel))) continue;
    const from = join(srcRoot, rel);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(destRoot, rel)), { recursive: true });
    copyFileSync(from, join(destRoot, rel));
    carried.push(rel);
  }
  return carried;
}

/** Copy `path` out of workspace `from` into workspace `to`, under the folder name `name`. */
export async function copyProjectBetween(
  userEmail: string,
  from: string,
  path: string,
  to: string,
  name: string,
): Promise<{ project: string; playlists?: string[] }> {
  // Both through getWorkspace, so a workspace that is not there is a 404 rather than an ENOENT.
  const src = getWorkspace(userEmail, from);
  const dest = getWorkspace(userEmail, to);
  const r = await dest.copyProject(src.projectFolder(path), name);
  const playlists = carryPlaylists(
    src.root,
    dest.root,
    dest.projectFolder(r.project),
  );
  // The destination gained a project, and the home page's listing is behind a five-second window.
  forgetListing(slugify(userEmail));
  return playlists.length ? { ...r, playlists } : r;
}
