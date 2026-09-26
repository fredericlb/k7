// bench.ts — the BENCH: one live rig, in a workspace of its own, thrown away and scaffolded again
// on every open. Nothing it holds is saved anywhere — what survives a session is what you wrote
// into the library, never the graph you wired to hear it. Rationale: apps/pl8/docs/banc.md.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { normalizeGitUri } from "@studio/git-repos/uri";
import { scaffoldLive } from "@studio/song/scaffoldLive";
import { BENCH_PROJECT } from "@studio/web-protocol/projects";
import { spliceChain } from "./benchChain.ts";
import { clonedFrom, ensureLibraries, librariesDir } from "./libraries.ts";
import { workspaceRoot } from "./slug.ts";

/** The workspace the bench lives in — reserved by convention, capitalised as `Examples` is. */
export const BENCH_WORKSPACE = "Banc";

/** Where the account's library is cloned when its URI is ADDED — the bench's own workspace, see docs/libraries.md. */
export function benchLibrariesDir(): string {
  return librariesDir(workspaceRoot(BENCH_WORKSPACE));
}

/**
 * Clone the account's library into the bench's workspace. This is what VALIDATES a URI when it is
 * added — a repository that will not clone is not one — and the clone it leaves is the one the
 * bench opens against, so the first bench costs nothing more. See docs/libraries.md.
 */
export async function ensureBenchLibraries(
  userEmail: string,
  uri: string,
): Promise<void> {
  const root = workspaceRoot(BENCH_WORKSPACE);
  mkdirSync(root, { recursive: true });
  const at = benchLibrariesDir();
  // A clone of ANOTHER repository is thrown away rather than kept: this folder is the URI's proof.
  const from = existsSync(at) ? await clonedFrom(at, userEmail) : null;
  if (from && normalizeGitUri(from) !== normalizeGitUri(uri))
    rmSync(at, { recursive: true, force: true });
  await ensureLibraries(userEmail, root, uri);
}

/** The bench, made fresh: the folder is REMOVED and written again, which is the whole of `jetable`; `chain` seeds it with a copy of that library chain. */
export async function ensureBench(
  userEmail: string,
  libraries: string,
  chain?: string,
): Promise<{ workspace: string; project: string }> {
  // A workspace of its own, so a library submodule of its own: every module the rig can name is in it.
  const root = workspaceRoot(BENCH_WORKSPACE);
  mkdirSync(root, { recursive: true });
  await ensureLibraries(userEmail, root, libraries);

  // A bench per CHAIN is an address that no longer exists; left there it would be a project saving nowhere.
  rmSync(join(root, "chains"), { recursive: true, force: true });

  const dir = join(root, BENCH_PROJECT);
  rmSync(dir, { recursive: true, force: true });
  // Named after the workspace and not after the folder: what the app says everywhere is "the bench".
  scaffoldLive(dir, BENCH_WORKSPACE);
  if (chain) spliceChain(dir, chain);

  return { workspace: BENCH_WORKSPACE, project: BENCH_PROJECT };
}
