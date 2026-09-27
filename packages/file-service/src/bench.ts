// bench.ts — the BENCH: one live rig, in a workspace of its own, thrown away and scaffolded again
// on every open. Nothing it holds is saved anywhere — what survives a session is what you wrote
// into a library, never the graph you wired to hear it. Rationale: apps/pl8/docs/banc.md.

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scaffoldLive } from "@studio/song/scaffoldLive";
import { BENCH_PROJECT } from "@studio/web-protocol/projects";
import { spliceChain } from "./benchChain.ts";
import { retireWorkspaceLibraries, syncLibraries } from "./libraries.ts";
import { workspaceRoot } from "./slug.ts";

/** The workspace the bench lives in — reserved by convention, capitalised as `Examples` is. */
export const BENCH_WORKSPACE = "Banc";

/**
 * The bench's project folder, whether or not it exists: the directory the ACCOUNT's own views
 * (its chains, a cut's model) resolve modules through when no workspace is open. Any project
 * sees the same libraries, since they are the account's; this one is simply always the same.
 */
export const benchDir = (): string =>
  join(workspaceRoot(BENCH_WORKSPACE), BENCH_PROJECT);

/** The bench, made fresh: the folder is REMOVED and written again, which is the whole of `jetable`; `chain` seeds it with a copy of that library chain. */
export async function ensureBench(
  userEmail: string,
  chain?: string,
): Promise<{ workspace: string; project: string }> {
  const root = workspaceRoot(BENCH_WORKSPACE);
  mkdirSync(root, { recursive: true });
  // The libraries at their latest, so a chain just published is the one the rig gets — docs/libraries.md.
  for (const r of await syncLibraries(userEmail))
    if (r.state === "failed" || r.state === "kept")
      console.warn(`[libraries] ${r.name}: ${r.note}`);
  // The bench held the account's clone once; the account holds it now.
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
