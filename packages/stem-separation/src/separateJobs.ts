// separateJobs.ts — a separation takes minutes, so it is started and then POLLED. The second
// job registry here, and it copies cloneJobs.ts on purpose: same Map, same sweep, same
// snapshot. Two things differ, and both are in the docblocks below. See docs/stemSplit.md.

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { SeparateJob } from "@studio/web-protocol";

const KEEP_MS = 5 * 60 * 1000;
const MAX_LINES = 50;

/** Set past any honest run rather than near the expected one — see docs/stemSplit.md. */
const TIMEOUT_MS = 60 * 60 * 1000;

const jobs = new Map<string, SeparateJob & { at: number; worker?: Worker }>();

/** Keyed by the WORK — who, which file, which model — and not by a workspace; docs/stemSplit.md. */
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

  // A WORKER, not the event loop: this service is shared, and ORT lives in-process (docs/stemSplit.md).
  const worker = new Worker(
    fileURLToPath(new URL("./separateWorker.ts", import.meta.url)),
    {
      workerData: { source, model, outDir },
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

export function separateJob(id: string): SeparateJob | null {
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
