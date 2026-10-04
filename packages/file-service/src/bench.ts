// bench.ts — the BENCH: one live rig, in a workspace of its own, thrown away and scaffolded again
// on every open. Two kinds: an admin's bench ON a library (`@banc/@<lib>/live.st0`), the only place
// that library can be edited, in a clone of its own (libraryBench.ts); and a bench seeded with a
// library CHAIN, which anyone plays and nobody edits through. Rationale: apps/pl8/docs/banc.md.

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scaffoldLive } from "@studio/song/scaffoldLive";
import {
  BENCH_PROJECT,
  benchChainOf,
  benchLibraryOf,
} from "@studio/web-protocol/projects";
import { spliceChain } from "./benchChain.ts";
import { refreshLibraries, retireWorkspaceLibraries } from "./libraries.ts";
import { closeLibraryBench, openLibraryBench } from "./libraryBench.ts";
import { workspaceRoot } from "./slug.ts";

/** The workspace the bench lives in — reserved by convention, capitalised as `Examples` is. */
export const BENCH_WORKSPACE = "Banc";

/**
 * The bench's project folder, whether or not it exists: the directory the ACCOUNT's own views
 * (its chains, a cut's model) resolve modules through when no workspace is open. Any project
 * sees the same libraries; this one is simply always the same.
 */
export const benchDir = (): string =>
  join(workspaceRoot(BENCH_WORKSPACE), BENCH_PROJECT);

/** The bench `project` names, made fresh: the folder is REMOVED and written again; a library bench opens its clone first. */
export async function ensureBench(
  userEmail: string,
  project: string,
): Promise<{ workspace: string; project: string }> {
  const library = benchLibraryOf(project);
  const chain = library ? null : benchChainOf(project);
  if (!library && !chain)
    throw new Error("a bench opens on a library, or on one of their chains");
  const root = workspaceRoot(BENCH_WORKSPACE);
  mkdirSync(root, { recursive: true });
  // The hub's clones at their latest, so a chain just published is the one the rig gets — docs/libraries.md.
  await refreshLibraries();
  if (library) await openLibraryBench(userEmail, library);
  else closeLibraryBench();
  // The bench held the account's clone once; the hub holds it now.
  const retired = await retireWorkspaceLibraries(userEmail, root).catch(
    (e: Error) => ({ retired: false, note: e.message }),
  );
  if (retired && !retired.retired)
    console.warn(`[libraries] ${root}: ${retired.note}`);

  // A bench per CHAIN is an address that no longer exists; left there it would be a project saving nowhere.
  rmSync(join(root, "chains"), { recursive: true, force: true });

  const dir = benchDir();
  rmSync(dir, { recursive: true, force: true });
  // Named after the workspace and not after the folder: what the app says everywhere is "the bench".
  scaffoldLive(dir, BENCH_WORKSPACE);
  if (chain) spliceChain(dir, chain);

  return { workspace: BENCH_WORKSPACE, project: BENCH_PROJECT };
}
