// coldRun.ts — which model a cut runs and what it writes, resolved from a chain of the account's
// library: the ONE step a server can do for a separation, since the running is the engine
// machine's (packages/stem-separation/docs/stemSplit.md). A chain named by the caller, else the
// account's standing answer. See docs/processChain.md.

import { resolveChain } from "@studio/audio-passes/processChain";
import { emptyDoc } from "@studio/engine-protocol/build";
import { loadPreferences } from "@studio/song/preferences";
import { accountLibraries } from "@studio/song/sharedFolders";
import { INSTRUMENTAL } from "@studio/song-schema/stems";
import { benchDir } from "./bench.ts";

export type ColdRun =
  | { ok: true; model: string; outputs: string[] }
  | { ok: false; status: number; error: string };

/** Resolve what a cut of `want` runs, through `chainRef` or the account's own setting; every refusal names its remedy. */
export function resolveColdRun(want: string, chainRef: string): ColdRun {
  const w = want.trim().toLowerCase() || "stems";
  if (w !== "stems" && w !== INSTRUMENTAL)
    return {
      ok: false,
      status: 400,
      error: `want must be 'stems' or '${INSTRUMENTAL}'`,
    };
  const wantsMix = w === INSTRUMENTAL;
  const prefs = loadPreferences();
  const ref =
    chainRef.trim() ||
    ((wantsMix ? prefs.instrumentalChain : prefs.stemsChain) ?? "");
  if (!ref)
    return {
      ok: false,
      status: 409,
      error:
        `no chain named, and this account ${wantsMix ? "makes no instrumental" : "separates nothing"} yet — ` +
        `name one, or set one once with \`${wantsMix ? "system instrumental" : "system stems"} <chaîne>\``,
    };
  if (!accountLibraries().length)
    return {
      ok: false,
      status: 409,
      error:
        "this machine has cloned none of the account's libraries yet — add one on st0's home page, or open a project once",
    };
  let resolved: ReturnType<typeof resolveChain>;
  try {
    // Any project sees the account's libraries; the bench's folder is simply always the same one.
    resolved = resolveChain(benchDir(), emptyDoc(), ref);
  } catch (e) {
    return { ok: false, status: 400, error: (e as Error).message };
  }
  const step = resolved.cold[0];
  if (!step)
    return {
      ok: false,
      status: 400,
      error: `'${ref}' does not separate — it puts the signal through ${resolved.plugins.length} module(s)`,
    };
  // Refused here rather than collected: four stems, one of them called the instrumental, is the mistake.
  if (wantsMix && !step.outputs.includes(INSTRUMENTAL))
    return {
      ok: false,
      status: 400,
      error: `'${ref}' writes ${step.outputs.join(", ")} and no instrumental`,
    };
  return { ok: true, model: step.model, outputs: [...step.outputs] };
}
