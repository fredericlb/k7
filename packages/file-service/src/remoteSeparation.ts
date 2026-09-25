// remoteSeparation.ts — a HOSTED file service cuts nothing itself: every separation runs on the
// machine of the engine it is bound to, over the jobs path its hub bound beside the engine's
// (packages/engine-tunnel/docs/jobs.md). Pollers see the same job records as a local run, so
// nothing that starts or waits on one knows the difference. See docs/owner.md.

import { JobError, requestJob } from "@studio/engine-tunnel/jobs-client";
import {
  type SeparationRunner,
  type StartSeparate,
  separationId,
} from "@studio/stem-separation/separateJobs";
import type { SeparateJob } from "@studio/web-protocol";
import { WebSocket } from "ws";

/** A finished job is kept this long for its last poll, as a local one is. */
const KEEP_MS = 5 * 60 * 1000;

interface Held {
  job: SeparateJob;
  at: number;
}

const blank = (id: string, source: string): SeparateJob => ({
  id,
  source,
  done: false,
  failed: false,
  error: null,
  phase: "sending",
  percent: null,
  lines: [],
  files: [],
});

/** Runs every separation on the bound engine's machine; `jobsUrl` answers null while none is bound. */
export function remoteSeparationRunner(
  jobsUrl: () => string | null,
): SeparationRunner {
  const jobs = new Map<string, Held>();
  const sweep = (): void => {
    const cutoff = Date.now() - KEEP_MS;
    for (const [id, h] of jobs)
      if (h.job.done && h.at < cutoff) jobs.delete(id);
  };
  const fail = (h: Held, error: string): void => {
    h.job = { ...h.job, done: true, failed: true, error, phase: "failed" };
    h.at = Date.now();
  };

  return {
    start(opts: StartSeparate): SeparateJob {
      sweep();
      const outputs = opts.outputs ? [...opts.outputs] : [];
      const id = separationId(opts.userEmail, opts.source, opts.model, outputs);
      const running = jobs.get(id);
      if (running && !running.job.done) return { ...running.job };
      const h: Held = { job: blank(id, opts.source), at: Date.now() };
      jobs.set(id, h);
      const url = jobsUrl();
      if (!url) {
        fail(h, "no engine to cut on — open this project on an engine first");
        return { ...h.job };
      }
      const ws = new WebSocket(url);
      ws.on("error", () => {});
      requestJob(
        ws,
        {
          type: "separate",
          user: opts.userEmail,
          source: opts.source,
          model: opts.model,
          outputs,
          outDir: opts.outDir,
        },
        (r) => r.type === "separated",
        (r) => {
          // The machine's record, with this side's id: pollers ask by the id they were given.
          h.job = { ...(r.job as SeparateJob), id };
          h.at = Date.now();
        },
      )
        .catch((e: Error) =>
          fail(
            h,
            e instanceof JobError
              ? e.message
              : `the engine's machine: ${e.message}`,
          ),
        )
        .finally(() => ws.close());
      return { ...h.job };
    },

    job(id: string): SeparateJob | null {
      const h = jobs.get(id);
      return h
        ? { ...h.job, lines: [...h.job.lines], files: [...h.job.files] }
        : null;
    },
  };
}
