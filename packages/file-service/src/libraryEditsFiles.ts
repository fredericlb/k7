// libraryEditsFiles.ts — an admin's edit clone of one library, READ: its tree, what git has not
// committed in it, one path's diff against HEAD and one file's content — what the home page's
// workspace tree reads of a workspace, here for the editor's "show diff" of the libraries.
// Paths are relative to the library's root. See docs/libraries.md.

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { libraryOverlays } from "@studio/song/sharedFolders";
import type { FileContent, FileNode, GitChange } from "@studio/web-protocol";
import { isBinary, skip } from "./workspace.ts";
import {
  checkedPath,
  workspaceChanges,
  workspaceDiff,
} from "./workspaceChanges.ts";

/** The root of this account's edit clone of `library`, or a refusal when there is none. */
function rootOf(library: string): string {
  const root = libraryOverlays().find((l) => l.name === library)?.root;
  if (!root)
    throw Object.assign(new Error(`no edit clone of '${library}' here`), {
      status: 404,
    });
  return root;
}

function walk(root: string, rel = ""): FileNode[] {
  return readdirSync(join(root, rel), { withFileTypes: true })
    .filter((e) => !skip(e.name))
    .map((e): FileNode => {
      const path = rel ? `${rel}/${e.name}` : e.name;
      return e.isDirectory()
        ? { name: e.name, path, dir: true, children: walk(root, path) }
        : {
            name: e.name,
            path,
            dir: false,
            kind: isBinary(e.name) ? "binary" : "text",
          };
    });
}

/** The clone's tree and its uncommitted paths. */
export async function libraryEditFiles(
  library: string,
): Promise<{ nodes: FileNode[]; changes: GitChange[] }> {
  const root = rootOf(library);
  return { nodes: walk(root), changes: await workspaceChanges(root) };
}

/** One path's diff against HEAD. */
export function libraryEditDiff(
  library: string,
  path: string,
): Promise<string> {
  return workspaceDiff(rootOf(library), path);
}

/** One file's content, read-only. */
export function libraryEditRead(library: string, path: string): FileContent {
  const abs = join(rootOf(library), checkedPath(path));
  if (isBinary(basename(abs))) return { path, binary: true, content: "" };
  return { path, binary: false, content: readFileSync(abs, "utf8") };
}
