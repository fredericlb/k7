// coldPass.ts — the work an OFFLINE module does before a render, on a file, producing files
// rather than a buffer. It decides WHAT to run and
// refuses early; the running itself arrives as a function, because the thing that owns a
// 166 MB model is the file service and this package must not depend on it.
// See @studio/song's docs/coldModules.md.

import { dirname, join } from "node:path";
import type { loadModuleRefs } from "@studio/song/loader";
import { OFFLINE_TYPE } from "@studio/song/project";
import {
  isSeparationOutput,
  type SeparationOutput,
  STEMS,
  STEMS_DIR,
} from "@studio/song-schema/stems";

// Spelled the way processChain.ts spells it — the resolved module as the loader hands it over.
type LoadedModule = ReturnType<typeof loadModuleRefs>[string];

// The folder a separation writes into, re-exported from the one place that names it.
export { STEMS_DIR } from "@studio/song-schema/stems";

/** One step of a chain that produces files instead of processing a buffer. */
export interface ColdStep {
  step: string; // the node name, for messages
  model: string; // the resolved model file, absolute
  /** What the module DECLARES it writes — the four stems, or the instrumental; docs/processChain.md. */
  outputs: SeparationOutput[];
}

/** Run one cold step over one source — the SEAM, a function rather than an import; docs/processChain.md. */
export type RunColdStep = (opts: {
  step: ColdStep;
  source: string;
  outDir: string;
}) => Promise<string[]>;

/** Is this module one whose outputs are produced offline, onto disk? */
export function isOfflineModule(m: { plugin?: { type?: unknown } }): boolean {
  return String(m.plugin?.type ?? "").toLowerCase() === OFFLINE_TYPE;
}

/** What an offline step needs, or a refusal naming what to do — asked BEFORE any render. */
export function coldStepOf(step: string, m: LoadedModule): ColdStep {
  const authored = m.assets?.onnx;
  if (!authored)
    throw new Error(
      `step '${step}' is an offline module but names no model — it needs an \`onnx:\` param`,
    );
  if (!m.onnx)
    throw new Error(
      `step '${step}' wants the model '${authored}', which is not on this machine — put it in ` +
        `~/.st0/models (or the module's own assets/)`,
    );
  return { step, model: String(m.onnx), outputs: outputsOf(step, m) };
}

/** What the pass writes: the outputs the module NAMES, the four stems when it names none of them. */
function outputsOf(step: string, m: LoadedModule): SeparationOutput[] {
  const named = (m.outputs ?? []).map((o) => String(o.name));
  const known = named.filter(isSeparationOutput);
  // A module that names none of them inherited its port from its type, and separates the four.
  if (!known.length) return [...STEMS];
  const strangers = named.filter((name) => !isSeparationOutput(name));
  if (strangers.length)
    throw new Error(
      `step '${step}' names outputs a separation can write and ones it cannot ` +
        `(${strangers.join(", ")}) — an output is one of the stems, or the instrumental`,
    );
  return known;
}

/** Where a source's cold outputs land: `stems/` beside it, never next to it. */
export function coldOutDir(source: string): string {
  return join(dirname(source), STEMS_DIR);
}

/** Run every cold step over every source — SEQUENTIAL both ways, and a failure stops the rest. */
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
