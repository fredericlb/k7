// workspaceListings.ts — what a workspace LISTS rather than compiles: the file tree an editor draws,
// the set lists under `_playlists/` and the reference tracks under `_references/`, every path
// handed back through the workspace's `toRel`. See docs/workspace.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { isDocName, wsRead } from "@studio/song/yaml/workspaceFile";
import { PLAYLISTS_DIR, parsePlaylist } from "@studio/song-schema/playlist";
import {
  isReferenceFile,
  REFERENCES_DIR,
  type ReferenceTrack,
  referenceName,
} from "@studio/song-schema/reference";
import type { FileNode } from "@studio/web-protocol";
import { projectApp } from "@studio/web-protocol/projects";
import { isBinary, skip } from "./workspaceFilter.ts";

type ToRel = (abs: string) => string;

/** A directory whose NAME claims an app and that EXISTS — the name rule, see docs/activeProject.md. */
export const isProjectDir = (dir: string): boolean => {
  if (projectApp(basename(dir)) === null) return false;
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** The tree under `abs`, folders first, minus what `skip` hides. */
export function fileTree(abs: string, toRel: ToRel): FileNode[] {
  const entries = readdirSync(abs, { withFileTypes: true })
    .filter((e) => !skip(e.name))
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    );
  return entries.map((e): FileNode => {
    const childAbs = join(abs, e.name);
    const path = toRel(childAbs);
    const children = e.isDirectory() ? fileTree(childAbs, toRel) : undefined;
    return children
      ? {
          name: e.name,
          path,
          dir: true,
          project: isProjectDir(childAbs) || undefined,
          // WHICH app opens it, beside the flag that says one does — that row must not guess.
          app: (isProjectDir(childAbs) && projectApp(e.name)) || undefined,
          children,
        }
      : {
          name: e.name,
          path,
          dir: false,
          kind: isBinary(e.name) ? "binary" : "text",
        };
  });
}

/** Every file under `at`, at any depth, that `keep` accepts; a missing folder is no files. */
function filesBelow(at: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no folder yet: a workspace with none of these has none, which is not an error
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && keep(e.name)) out.push(abs);
    }
  };
  walk(at);
  return out;
}

export interface PlaylistRow {
  path: string;
  name: string;
  title?: string;
  count: number;
  ok: boolean;
}

/** The playlists the workspace at `root` holds, at the ROOT and at any depth — see docs/workspace.md. */
export function playlistsIn(root: string, toRel: ToRel): PlaylistRow[] {
  return filesBelow(join(root, PLAYLISTS_DIR), isDocName)
    .map((abs) => {
      let parsed: ReturnType<typeof parsePlaylist> = null;
      try {
        parsed = parsePlaylist(wsRead(abs));
      } catch {
        parsed = null; // unreadable bytes read exactly like unparseable ones from here
      }
      return {
        path: toRel(abs),
        name: basename(abs).replace(/\.(ya?ml|k7x)$/i, ""),
        ...(parsed?.title ? { title: parsed.title } : {}),
        count: parsed?.items.length ?? 0,
        ok: parsed !== null,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The reference tracks the workspace at `root` holds — `_references/` at any depth, see docs/workspace.md. */
export function referencesIn(root: string, toRel: ToRel): ReferenceTrack[] {
  return filesBelow(join(root, REFERENCES_DIR), isReferenceFile)
    .map((abs) => {
      // The size is the one thing a listing can say without decoding; an unstattable file is 0.
      let bytes = 0;
      try {
        bytes = statSync(abs).size;
      } catch {}
      return { path: toRel(abs), name: referenceName(basename(abs)), bytes };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
