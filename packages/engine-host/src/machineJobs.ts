// machineJobs.ts — what this MACHINE does when a server asks over a jobs channel: the work that
// needs its CPU, its model or its hardware, with no file service in between. Paths arrive already
// local and leave already the server's; the tunnel moves the files. See
// packages/engine-tunnel/docs/jobs.md.

import type { JobHandler } from "@studio/engine-tunnel/agent";
import type { SeparationOutput } from "@studio/song-schema/stems";
import {
  separateJob,
  startSeparate,
} from "@studio/stem-separation/separateJobs";
import { syncJobs } from "./machineSync.ts";

/** How often a running separation reports; a cut takes minutes, and every report crosses the network. */
const REPORT_MS = 1000;

/** Split a mix with a model, both already on this disk, into `outDir`; one reply per change, the last `separated`. */
const separate: JobHandler = async (req, emit) => {
  const outputs = Array.isArray(req.outputs)
    ? (req.outputs.map(String) as SeparationOutput[])
    : undefined;
  const started = startSeparate({
    userEmail: String(req.user ?? ""),
    source: String(req.source ?? ""),
    model: String(req.model ?? ""),
    outDir: String(req.outDir ?? ""),
    outputs,
  });
  let last = "";
  for (;;) {
    const job = separateJob(started.id) ?? started;
    const said = JSON.stringify(job);
    if (said !== last)
      emit({ type: job.done ? "separated" : "separating", job });
    last = said;
    if (job.done) return;
    await new Promise((r) => setTimeout(r, REPORT_MS));
  }
};

/** Every job this machine answers, by request type. */
export const machineJobs: Record<string, JobHandler> = {
  separate,
  ...syncJobs,
};
