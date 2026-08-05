// separateJobs.ts — a separation takes minutes, so it is started and then POLLED. The second
// job registry here, and it copies cloneJobs.ts on purpose: same Map, same sweep, same
// snapshot. Two things differ, and both are in the docblocks below. See docs/stemSplit.md.

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { SeparateJob } from "@studio/web-protocol";

const KEEP_MS = 5 * 60 * 1000;
const MAX_LINES = 50;

/**
 * Far longer than `render.ts`'s five minutes, because it is bounding a different thing: a
 * render that takes five minutes has hung, while a separation that takes five minutes is a
 * long song on a CPU. The cap is here to stop a wedged worker holding a thread forever, so it
 * is set past any honest run rather than close to the expected one.
 */
const TIMEOUT_MS = 60 * 60 * 1000;

const jobs = new Map<string, SeparateJob & { at: number; worker?: Worker }>();

/**
 * Keyed by the WORK — who, which file, which model — not by a workspace.
 *
 * cloneJobs keys on the destination because that is what two clones would collide over. Here
 * the thing worth not doing twice is the inference itself: a second tab, a retry or a remount
 * would otherwise start another hour of arithmetic producing byte-identical files.
 */
function idFor(userEmail: string, source: string, model: string): string {
  return createHash("sha256")
    .update(`${userEmail}\0${source}\0${model}`)
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
}

/** Start a separation, or return the one already running for exactly this work. */
export function startSeparate(opts: StartSeparate): SeparateJob {
  sweep();
  const { userEmail, source, model, outDir } = opts;
  const id = idFor(userEmail, source, model);
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

  /**
   * A WORKER, not the event loop. This service is shared: it serves every workspace on the
   * machine, prewarms waveforms, polls the médiathèque every 60 s and answers `revision()`
   * every two. An hour of inference on the main thread would stall all of it. Every other
   * heavy job in this repo is an out-of-process spawn for the same reason; ORT lives in this
   * process, so a thread is what buys the same property.
   */
  const worker = new Worker(fileURLToPath(new URL("./separateWorker.ts", import.meta.url)), {
    workerData: { source, model, outDir },
  });
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
      const p = m.progress as { phase: string; percent: number | null; line?: string };
      job.phase = p.phase;
      job.percent = p.percent;
      if (p.line) {
        job.lines.push(p.line);
        if (job.lines.length > MAX_LINES) job.lines.shift();
      }
    } else if (m.done) {
      clearTimeout(timer);
      finish({ files: m.done as string[], phase: "done", percent: 100 });
    } else if (m.failed) {
      clearTimeout(timer);
      finish({ failed: true, error: String(m.failed), phase: "failed" });
    }
  });
  // A worker that dies without saying why — an OOM, a native crash inside ORT — would
  // otherwise leave the job running forever and the poller looping forever.
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

export function separateJob(id: string): SeparateJob | null {
  const j = jobs.get(id);
  return j ? snapshot(j) : null;
}

// A copy, so a caller cannot hold a reference that keeps changing under it mid-response — and
// so `worker`, which is not on the wire, never leaves this module.
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
