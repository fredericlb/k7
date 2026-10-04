// workspaceChanges.ts — what is not committed in a workspace, path by path, and one path's diff
// against HEAD: the home page's read-only tree colours the first and shows the second.
// An untracked file has no diff here — the caller shows its content as all added.
// See docs/workspaces.md § Sync state.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GitChange } from "@studio/web-protocol";

const run = promisify(execFile);

const QUICK_MS = 10_000;
/** A diff larger than this is a binary or a generated file nobody reads in a browser. */
const MAX_DIFF = 2 * 1024 * 1024;

/** Every uncommitted path, untracked files listed one by one rather than as their folder. */
export async function workspaceChanges(root: string): Promise<GitChange[]> {
  if (!existsSync(join(root, ".git"))) return [];
  const { stdout } = await run(
    "git",
    ["status", "--porcelain", "-z", "--untracked-files=all"],
    { cwd: root, timeout: QUICK_MS, maxBuffer: MAX_DIFF },
  );
  return parsePorcelainZ(stdout);
}

/** `XY path\0`, a rename or a copy followed by its ORIGINAL path as one more NUL-ended entry. */
export function parsePorcelainZ(out: string): GitChange[] {
  const parts = out.split("\0");
  const changes: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const code = e.slice(0, 2);
    const change: GitChange = { path: e.slice(3), code };
    if (code[0] === "R" || code[0] === "C") change.from = parts[++i];
    changes.push(change);
  }
  return changes;
}

/** A path the caller may hand git: relative, inside the workspace, no `..`. */
function checkedPath(path: string): string {
  const p = path.replace(/\\/g, "/");
  if (
    !p ||
    p.startsWith("/") ||
    /^[a-zA-Z]:/.test(p) ||
    p.split("/").includes("..")
  )
    throw Object.assign(new Error(`bad path: ${path}`), { status: 400 });
  return p;
}

/** The unified diff of one path, index and working tree against HEAD; empty when there is no HEAD yet. */
export async function workspaceDiff(
  root: string,
  path: string,
): Promise<string> {
  const p = checkedPath(path);
  if (!existsSync(join(root, ".git"))) return "";
  try {
    const { stdout } = await run(
      "git",
      [
        "--literal-pathspecs",
        "diff",
        "HEAD",
        "--no-color",
        "--no-ext-diff",
        "-M",
        "--",
        p,
      ],
      { cwd: root, timeout: QUICK_MS, maxBuffer: MAX_DIFF },
    );
    return stdout;
  } catch (e) {
    // An unborn branch has no HEAD to diff against: the caller shows the file as all added.
    if (/maxBuffer/i.test((e as Error).message)) return "(diff too large)\n";
    return "";
  }
}
