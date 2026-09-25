// machineJobs.ts — what this MACHINE does when a server asks over a jobs channel: the work that
// needs its CPU, its model or its hardware, with no file service in between. Paths arrive already
// local and leave already the server's; the tunnel moves the files. See
// packages/engine-tunnel/docs/jobs.md.

import { existsSync } from "node:fs";
import type { JobHandler } from "@studio/engine-tunnel/agent";
import type { SeparationOutput } from "@studio/song-schema/stems";
import {
  separateJob,
  startSeparate,
} from "@studio/stem-separation/separateJobs";
import { readLog } from "./machineLog.ts";
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

/** Where a song of the médiathèque is on THIS disk, brought down first — for a browser about to hand the engine that path. */
const local: JobHandler = (req, emit) => {
  const path = String(req.path ?? "");
  if (!path || !existsSync(path)) throw new Error("not in the médiathèque");
  // Under `raw`, so the channel does not spell it back into the server's path on the way out.
  emit({ type: "local", raw: { path } });
};

/** The songs a set list names, already brought down by the channel before this runs — so this only says so. */
const prefetch: JobHandler = (req, emit) => {
  const files = Array.isArray(req.files) ? req.files.map(String) : [];
  emit({
    type: "prefetched",
    count: files.filter((f) => existsSync(f)).length,
  });
};

/** A slice of this machine's log; `raw`, because a log line naming a path must read as this machine wrote it. */
const log: JobHandler = (req, emit) => {
  const offset = typeof req.offset === "number" ? req.offset : undefined;
  const tail = typeof req.tail === "number" ? req.tail : undefined;
  emit({ type: "log", raw: readLog({ offset, tail }) });
};

/** Every job this machine answers, by request type. */
export const machineJobs: Record<string, JobHandler> = {
  separate,
  local,
  prefetch,
  log,
  ...syncJobs,
};
