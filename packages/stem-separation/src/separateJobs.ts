// separateJobs.ts — a separation takes minutes, so it is started and then POLLED. The second
// job registry here, and it copies cloneJobs.ts on purpose: same Map, same sweep, same
// snapshot. Two things differ, and both are in the docblocks below. See docs/stemSplit.md.

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { type SeparationOutput, STEMS } from "@studio/song-schema/stems";
import type { SeparateJob } from "@studio/web-protocol";

const KEEP_MS = 5 * 60 * 1000;
const MAX_LINES = 50;

/** Set past any honest run rather than near the expected one — see docs/stemSplit.md. */
const TIMEOUT_MS = 60 * 60 * 1000;

const jobs = new Map<string, SeparateJob & { at: number; worker?: Worker }>();

/** A provider that lost its device once, for this service's lifetime — see docs/stemSplit.md. */
let lost: string | null = null;

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

function sweep(): void {
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, j] of jobs) if (j.done && j.at < cutoff) jobs.delete(id);
}

export interface StartSeparate {
  userEmail: string;
  source: string; // absolute path to the mix
  model: string; // absolute path to the .onnx
  outDir: string; // where the stems land — <song folder>/stems
  /** What to write: the four stems when absent — see docs/stemSplit.md. */
  outputs?: readonly SeparationOutput[];
  /** The execution providers to try, in order, as the machine is set; the CPU when absent. */
  providers?: readonly string[];
}

/** Where a separation RUNS: in this process unless the host installed another — docs/stemSplit.md. */
export interface SeparationRunner {
  start(opts: StartSeparate): SeparateJob;
  job(id: string): SeparateJob | null;
}

let runner: SeparationRunner | null = null;

/** Send every separation elsewhere — a hosted file service, to its engine's machine — or back here with null. */
export function setSeparationRunner(r: SeparationRunner | null): void {
  runner = r;
}

/** Start a separation, or return the one already running for exactly this work. */
export function startSeparate(opts: StartSeparate): SeparateJob {
  return runner ? runner.start(opts) : startLocal(opts);
}

/** Where a separation got to, wherever it runs; null for one this process has forgotten. */
export function separateJob(id: string): SeparateJob | null {
  return runner ? runner.job(id) : localJob(id);
}

function startLocal(opts: StartSeparate): SeparateJob {
  sweep();
  const { userEmail, source, model, outDir } = opts;
  const outputs = opts.outputs?.length ? [...opts.outputs] : [...STEMS];
  const id = separationId(userEmail, source, model, outputs);
  const running = jobs.get(id);
  if (running && !running.done) return snapshot(running);

  const job: SeparateJob & { at: number; worker?: Worker } = {
    id,
    source,
    done: false,
    failed: false,
    error: null,
    phase: "starting",
    percent: null,
    lines: [],
    files: [],
    at: Date.now(),
  };
  jobs.set(id, job);

  const finish = (patch: Partial<SeparateJob>) => {
    Object.assign(job, patch);
    job.done = true;
    job.at = Date.now();
    job.worker = undefined;
  };

  // A WORKER, not the event loop: this service is shared, and ORT lives in-process (docs/stemSplit.md).
  const worker = new Worker(
    fileURLToPath(new URL("./separateWorker.ts", import.meta.url)),
    {
      // A song that reset the GPU makes the next one start on the CPU, rather than resetting it again.
      workerData: {
        source,
        model,
        outDir,
        outputs,
        providers: lost
          ? ["cpu"]
          : opts.providers
            ? [...opts.providers]
            : undefined,
      },
    },
  );
  job.worker = worker;

  const timer = setTimeout(() => {
    void worker.terminate();
    finish({
      failed: true,
      error: `separation of ${source} exceeded ${TIMEOUT_MS / 60000} minutes`,
      phase: "failed",
    });
  }, TIMEOUT_MS);
  // The timer must not be what keeps a finished service alive.
  timer.unref?.();

  worker.on("message", (m: Record<string, unknown>) => {
    if (m.progress) {
      const p = m.progress as {
        phase: string;
        percent: number | null;
        line?: string;
      };
      job.phase = p.phase;
      job.percent = p.percent;
      if (p.line) {
        job.lines.push(p.line);
        if (job.lines.length > MAX_LINES) job.lines.shift();
      }
    } else if (m.lostProvider) {
      lost = String(m.lostProvider);
    } else if (m.done) {
      clearTimeout(timer);
      finish({ files: m.done as string[], phase: "done", percent: 100 });
    } else if (m.failed) {
      clearTimeout(timer);
      finish({ failed: true, error: String(m.failed), phase: "failed" });
    }
  });
  // A worker that dies without saying why would otherwise leave the poller looping forever.
  worker.on("error", (e: Error) => {
    clearTimeout(timer);
    finish({ failed: true, error: e.message, phase: "failed" });
  });
  worker.on("exit", (code) => {
    clearTimeout(timer);
    if (!job.done)
      finish({
        failed: true,
        error: `the separation worker exited with code ${code}`,
        phase: "failed",
      });
  });

  return snapshot(job);
}

function localJob(id: string): SeparateJob | null {
  const j = jobs.get(id);
  return j ? snapshot(j) : null;
}

// A copy: nothing changes under a caller mid-response, and `worker` never leaves this module.
function snapshot(j: SeparateJob): SeparateJob {
  return {
    id: j.id,
    source: j.source,
    done: j.done,
    failed: j.failed,
    error: j.error,
    phase: j.phase,
    percent: j.percent,
    lines: [...j.lines],
    files: [...j.files],
  };
}
