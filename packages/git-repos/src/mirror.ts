// mirror.ts — a bare, blobless copy of a repository, kept so a hosted service can answer
// "what files are in there" without ever making a working copy. Trees and commits only: a
// project is detected by the NAME of a folder (`.l8`, `.m9`) and never by any file's
// content, which is exactly what lets this skip the blobs. See docs/mirror.md.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { FileNode, RepoProject } from "@studio/web-protocol";
import { type ProjectApp, projectApp } from "@studio/web-protocol/projects";
import { gitEnv } from "./keys.ts";
import { assertSshGitUri } from "./uri.ts";

const run = promisify(execFile);

/** Long enough for a big history over a slow link, short enough that a hung fetch is not forever. */
const FETCH_TIMEOUT_MS = 120_000;
/** Reading refs and trees is local work; a minute here means something is wrong, not slow. */
const LOCAL_TIMEOUT_MS = 60_000;

async function git(
  dir: string,
  args: string[],
  keyDir: string,
  timeout: number,
): Promise<string> {
  try {
    const { stdout } = await run("git", args, {
      cwd: dir,
      env: gitEnv(keyDir),
      timeout,
      maxBuffer: 64 * 1024 * 1024, // a big repo's ls-tree is megabytes of paths
    });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message: string; code?: string };
    if (err.code === "ENOENT")
      throw new Error(
        "the 'git' CLI is required — install it from https://git-scm.com",
      );
    throw new Error((err.stderr || err.message).trim());
  }
}

/**
 * Create the mirror if it is not there, otherwise leave it alone. `--mirror` rather than
 * `--bare` for the refspec it writes: without one, a later `git fetch` lands in FETCH_HEAD
 * and the mirror silently never moves.
 *
 * A server that cannot do partial clone refuses `--filter`, so the whole thing is retried
 * without it — a full bare mirror is heavier but still not a working copy, and being unable
 * to list a repository is worse than paying for its blobs.
 */
export async function ensureMirror(
  dir: string,
  uri: string,
  keyDir: string,
): Promise<void> {
  assertSshGitUri(uri);
  if (existsSync(dir)) return;
  mkdirSync(dirname(dir), { recursive: true });
  const clone = (filter: boolean) =>
    git(
      dirname(dir),
      [
        "clone",
        "--mirror",
        ...(filter ? ["--filter=blob:none"] : []),
        "--",
        uri,
        dir,
      ],
      keyDir,
      FETCH_TIMEOUT_MS,
    );
  try {
    await clone(true);
  } catch (first) {
    // `dir` did not exist above, so whatever is there is our debris — never leave a half-mirror.
    rmSync(dir, { recursive: true, force: true });
    try {
      await clone(false);
    } catch {
      rmSync(dir, { recursive: true, force: true });
      throw first;
    }
  }
}

/** Bring an existing mirror up to date, dropping refs the remote deleted. */
export async function refreshMirror(
  dir: string,
  keyDir: string,
): Promise<void> {
  await git(dir, ["fetch", "--prune"], keyDir, FETCH_TIMEOUT_MS);
}

/** The branch HEAD names, e.g. `main`. Null when the repository has no commits yet. */
export async function defaultBranch(
  dir: string,
  keyDir: string,
): Promise<string | null> {
  try {
    const out = await git(
      dir,
      ["symbolic-ref", "--short", "HEAD"],
      keyDir,
      LOCAL_TIMEOUT_MS,
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Every file in the mirror's HEAD, repository-relative with POSIX separators.
 *
 * Files only — `-r` without `-t` lists blobs, and directories are implied by the paths.
 * That matches git, which has no empty directories to lose.
 */
export async function listFiles(
  dir: string,
  keyDir: string,
): Promise<string[]> {
  const out = await git(
    dir,
    ["ls-tree", "-r", "--name-only", "-z", "HEAD"],
    keyDir,
    LOCAL_TIMEOUT_MS,
  );
  // -z: a path may contain anything but NUL, and git would otherwise quote-escape the odd ones.
  return out.split("\0").filter(Boolean);
}

/**
 * The project directories in a repository, mapped to the app that opens each.
 *
 * By the folder's NAME — `mysong.l8`, `myset.m9` — and at any depth. A directory exists here
 * only because a file inside it does, which is git's own rule: it tracks no empty folders, so
 * a project with nothing in it is not a project anyone has lost.
 *
 * Every suffixed folder is reported, including one nested inside another. That is deliberate:
 * a `.m9` set living inside a `.l8` song's folder is a real arrangement, and picking an
 * outermost winner would hide the inner one with nothing on screen to say so.
 */
export function projectDirs(files: string[]): Map<string, ProjectApp> {
  const out = new Map<string, ProjectApp>();
  for (const f of files) {
    const segs = f.split("/");
    // The file's own name is not a folder — stop before it.
    let path = "";
    for (let i = 0; i < segs.length - 1; i++) {
      path = path ? `${path}/${segs[i]}` : segs[i];
      const app = projectApp(segs[i]);
      if (app) out.set(path, app);
    }
  }
  return out;
}

// Hidden from the tree for the same reasons the file service hides them (workspace.ts's `skip`).
const SKIP = new Set(["node_modules", "_recycle_bin"]);
const skip = (name: string): boolean =>
  name.startsWith(".") || SKIP.has(name) || name.endsWith(".cache");

// Files shown but not editable — mirrored from the file service's own list.
const BINARY_EXT =
  /\.(wav|mp3|ogg|flac|aif|aiff|m4a|mp4|mov|webm|png|jpg|jpeg|gif|ico|svg|pdf|zip|vstpreset|nam|wasm)$/i;

/**
 * The file list as the nested shape every tree in this repo draws — the file service's
 * `FileNode`, so st0's Projets section and l8's own tree agree on what a row is.
 */
export function buildTree(
  files: string[],
  projects: Map<string, ProjectApp>,
): FileNode[] {
  const root: FileNode = { name: "", path: "", dir: true, children: [] };
  const dirs = new Map<string, FileNode>([["", root]]);

  const dirNode = (path: string): FileNode | null => {
    const found = dirs.get(path);
    if (found) return found;
    const cut = path.lastIndexOf("/");
    const name = cut < 0 ? path : path.slice(cut + 1);
    if (skip(name)) return null;
    const parent = dirNode(cut < 0 ? "" : path.slice(0, cut));
    if (!parent) return null;
    const app = projects.get(path);
    const node: FileNode = {
      name,
      path,
      dir: true,
      project: app ? true : undefined,
      app,
      children: [],
    };
    parent.children!.push(node);
    dirs.set(path, node);
    return node;
  };

  for (const f of files) {
    const cut = f.lastIndexOf("/");
    const name = cut < 0 ? f : f.slice(cut + 1);
    if (skip(name)) continue;
    const parent = dirNode(cut < 0 ? "" : f.slice(0, cut));
    if (!parent) continue; // a skipped ancestor takes its whole subtree with it
    parent.children!.push({
      name,
      path: f,
      dir: false,
      kind: BINARY_EXT.test(name) ? "binary" : "text",
    });
  }

  // Same order the file service walks in: folders first, then by name.
  const sort = (nodes: FileNode[]): FileNode[] => {
    nodes.sort((a, b) =>
      a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1,
    );
    for (const n of nodes) if (n.children) sort(n.children);
    return nodes;
  };
  return sort(root.children!);
}

/** Where a project is and which app opens it — defined with the wire types, since the
 *  listing sends it to the browser, and re-exported here for this module's own callers. */
export type { RepoProject };

/** Everything a caller wants from one mirror: the tree, and where the projects are. */
export async function readRepo(
  dir: string,
  keyDir: string,
): Promise<{
  nodes: FileNode[];
  projects: RepoProject[];
  branch: string | null;
}> {
  const [files, branch] = await Promise.all([
    listFiles(dir, keyDir),
    defaultBranch(dir, keyDir),
  ]);
  const projects = projectDirs(files);
  return {
    nodes: buildTree(files, projects),
    projects: [...projects]
      .map(([path, app]) => ({ path, app }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    branch,
  };
}
