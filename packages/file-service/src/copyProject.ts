// copyProject.ts — copying a project from one workspace into another on this machine. Its own
// module because it is the one act naming TWO workspaces: neither Workspace instance owns it,
// and each end still answers for its own guards. What the project names at the workspace level —
// its playlists and its `@workspace` modules — comes along. See docs/workspaces.md.

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { projectSurfaces } from "@studio/song/surfaces";
import { SHARED_MODULES_DIR } from "@studio/song-schema/moduleTypes";
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

/** The text a module reference can be written in; audio and caches are never read. */
const TEXT = new Set([".k7x", ".yaml", ".yml", ".json", ".ts", ".js", ".md"]);

/** `@workspace/a/b` → `a/b`, never climbing out; a trailing `.k7x` or `#port` is not part of the path. */
const WORKSPACE_REF = /@workspace\/([A-Za-z0-9_-][A-Za-z0-9_.\-/]*)/g;

/** Every `@workspace` module path named in the text files under `dir`. */
function workspaceRefs(dir: string, into: Set<string>): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith("."))
        workspaceRefs(abs, into);
      continue;
    }
    if (!TEXT.has(extname(e.name))) continue;
    for (const m of readFileSync(abs, "utf8").matchAll(WORKSPACE_REF)) {
      const path = m[1].replace(/\.k7x$/, "").replace(/\/+$/, "");
      if (!path.split("/").includes("..")) into.add(path);
    }
  }
}

/**
 * The `@workspace` modules the copy NAMES, carried into the destination's `_modules` — and the ones
 * those name in turn. A module the destination already has is left alone: its own is the one its
 * other projects already extend, as with a playlist.
 */
function carryModules(
  srcRoot: string,
  destRoot: string,
  projectAbs: string,
): string[] {
  const carried: string[] = [];
  const seen = new Set<string>();
  const todo = new Set<string>();
  workspaceRefs(projectAbs, todo);
  while (todo.size) {
    const [path] = todo;
    todo.delete(path);
    if (seen.has(path)) continue;
    seen.add(path);
    // A module is a folder (`_modules/a/b/module.k7x`) or a single file (`_modules/a/b.k7x`).
    for (const rel of [path, `${path}.k7x`]) {
      const from = join(srcRoot, SHARED_MODULES_DIR, rel);
      const to = join(destRoot, SHARED_MODULES_DIR, rel);
      if (!existsSync(from) || existsSync(to)) continue;
      mkdirSync(dirname(to), { recursive: true });
      if (statSync(from).isDirectory()) {
        cpSync(from, to, { recursive: true });
        workspaceRefs(to, todo);
      } else {
        copyFileSync(from, to);
        for (const m of readFileSync(to, "utf8").matchAll(WORKSPACE_REF))
          todo.add(m[1].replace(/\.k7x$/, ""));
      }
      carried.push(`${SHARED_MODULES_DIR}/${rel}`);
      break;
    }
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
): Promise<{ project: string; playlists?: string[]; modules?: string[] }> {
  // Both through getWorkspace, so a workspace that is not there is a 404 rather than an ENOENT.
  const src = getWorkspace(userEmail, from);
  const dest = getWorkspace(userEmail, to);
  const r = await dest.copyProject(src.projectFolder(path), name);
  const playlists = carryPlaylists(
    src.root,
    dest.root,
    dest.projectFolder(r.project),
  );
  const modules = carryModules(
    src.root,
    dest.root,
    dest.projectFolder(r.project),
  );
  // The destination gained a project, and the home page's listing is behind a five-second window.
  forgetListing(slugify(userEmail));
  return {
    ...r,
    ...(playlists.length ? { playlists } : {}),
    ...(modules.length ? { modules } : {}),
  };
}
