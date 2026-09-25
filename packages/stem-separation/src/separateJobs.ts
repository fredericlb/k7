// separateJobs.ts — a separation takes minutes, so it is started and then POLLED. The work itself
// runs on an engine's MACHINE (the native supervisor, engine/st0-supervisor), never in this process:
// what is here is the seam a server hands it through, and the id that keys a job by its work.
// See docs/stemSplit.md.

import { createHash } from "node:crypto";
import type { SeparationOutput } from "@studio/song-schema/stems";
import type { SeparateJob } from "@studio/web-protocol";

/** Keyed by the WORK — who, which file, which model, which outputs — and not by a workspace; docs/stemSplit.md. */
export function separationId(
  userEmail: string,
  source: string,
  model: string,
  outputs: readonly string[],
): string {
  return createHash("sha256")
    .update(`${userEmail}\0${source}\0${model}\0${outputs.join(",")}`)
    .digest("hex")
    .slice(0, 16);
}

export interface StartSeparate {
  userEmail: string;
  source: string; // absolute path to the mix
  model: string; // absolute path to the .onnx
  outDir: string; // where the stems land — <song folder>/stems
  /** What to write: the four stems when absent — see docs/stemSplit.md. */
  outputs?: readonly SeparationOutput[];
}

/** Where a separation RUNS — the bound engine's machine, reached by the host that installs it. */
export interface SeparationRunner {
  start(opts: StartSeparate): SeparateJob;
  job(id: string): SeparateJob | null;
}

let runner: SeparationRunner | null = null;

/** Install where separations run; null takes it away. */
export function setSeparationRunner(r: SeparationRunner | null): void {
  runner = r;
}

/** Start a separation, or join the one already running for exactly this work. */
export function startSeparate(opts: StartSeparate): SeparateJob {
  if (!runner)
    throw new Error(
      "no machine to separate on — this process installed no runner",
    );
  return runner.start(opts);
}

/** Where a separation got to; null for one the runner has forgotten, or with no runner at all. */
export function separateJob(id: string): SeparateJob | null {
  return runner ? runner.job(id) : null;
}
