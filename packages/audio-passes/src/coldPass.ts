// coldPass.ts — the pass coldModules.md and processChain.md both say is missing: the work an
// OFFLINE module does before a render, on a file, producing files. It decides WHAT to run and
// refuses early; the running itself arrives as a function, because the thing that owns a
// 166 MB model is the file service and this package must not depend on it.
// See @studio/song's docs/coldModules.md.

import { dirname, join } from "node:path";
import type { loadModuleRefs } from "@studio/song/loader";
import { OFFLINE_TYPE } from "@studio/song/project";
import { STEMS_DIR } from "@studio/song-schema/stems";

// Spelled the way processChain.ts spells it — the resolved module as the loader hands it over.
type LoadedModule = ReturnType<typeof loadModuleRefs>[string];

// The folder a separation writes into, from the one place that names it. It was declared here
// too, and in routes/separate.ts, which made three spellings of `"stems"` for a word that has to
// agree across the pass, the scan and the deck. Re-exported so callers of this module are
// unchanged — see @studio/song's stems.ts for why not beside the master.
export { STEMS_DIR } from "@studio/song-schema/stems";

/** One step of a chain that produces files instead of processing a buffer. */
export interface ColdStep {
  step: string; // the node name, for messages
  model: string; // the resolved model file, absolute
}

/**
 * Run one cold step over one source. The seam.
 *
 * A function rather than an import because of where the pieces live: the inference is in
 * `@studio/file-service`, which depends on THIS package, so importing it back would be a
 * cycle. The caller supplies it — in-process on the machine that has the model, over
 * `POST /separate` from anywhere else — and neither choice leaks into the policy here.
 */
export type RunColdStep = (opts: {
  step: ColdStep;
  source: string;
  outDir: string;
}) => Promise<string[]>;

/** Is this module one whose outputs are produced offline, onto disk? */
export function isOfflineModule(m: { plugin?: { type?: unknown } }): boolean {
  return String(m.plugin?.type ?? "").toLowerCase() === OFFLINE_TYPE;
}

/**
 * What an offline step needs, or a refusal naming what to do.
 *
 * Asked BEFORE anything is rendered, for the reason processChain already gives about resolving
 * a chain first: a step this machine cannot run should cost no time and leave no file. The two
 * failures are told apart on purpose — a module that names no model is authored wrong, while
 * one whose model did not resolve is a machine that has not got it yet, and only the second is
 * fixed by downloading something.
 */
export function coldStepOf(step: string, m: LoadedModule): ColdStep {
  const authored = m.assets?.onnx;
  if (!authored)
    throw new Error(
      `step '${step}' is an offline module but names no model — it needs an \`onnx:\` param`,
    );
  if (!m.onnx)
    throw new Error(
      `step '${step}' wants the model '${authored}', which is not on this machine — put it in ` +
        `~/.studio/models (or the module's own assets/)`,
    );
  return { step, model: String(m.onnx) };
}

/** Where a source's cold outputs land: `stems/` beside it, never next to it. */
export function coldOutDir(source: string): string {
  return join(dirname(source), STEMS_DIR);
}

/**
 * Run every cold step over every source.
 *
 * Sequential, both ways round. Two separations at once on one machine is two hours of
 * arithmetic competing for the same cores and finishing no sooner, and the engine bounce this
 * runs in front of has always been one-at-a-time for the same reason.
 *
 * A failure stops the whole thing rather than being collected: the render that follows would
 * otherwise apply a chain whose first step silently did nothing, which is the failure mode
 * `mediatekChain` already refuses a missing module to avoid.
 */
export async function runColdPasses(
  sources: string[],
  steps: ColdStep[],
  run: RunColdStep,
): Promise<{ source: string; step: string; files: string[] }[]> {
  const out: { source: string; step: string; files: string[] }[] = [];
  for (const source of sources)
    for (const step of steps)
      out.push({
        source,
        step: step.step,
        files: await run({ step, source, outDir: coldOutDir(source) }),
      });
  return out;
}
