// cloneJobs.ts — a clone runs longer than a request should be held open, so it is started
// and then POLLED. The first job registry in this service, and deliberately so: `render.ts`
// argues against one and is still right about a render. See docs/cloneJobs.md.

import { createHash } from "node:crypto";
import type { CloneJob } from "@studio/web-protocol";
import { cloneWorkspace } from "./workspaces.ts";

/** How long a finished job stays readable — long enough for the poller to see how it ended. */
const KEEP_MS = 5 * 60 * 1000;
const MAX_LINES = 50;

const jobs = new Map<string, CloneJob & { at: number }>();

/** Keyed by (user, workspace) rather than a counter: the same clone asked for twice is one clone. */
function idFor(userEmail: string, workspace: string): string {
  return createHash("sha256")
    .update(`${userEmail}\0${workspace}`)
    .digest("hex")
    .slice(0, 16);
}

function sweep(): void {
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, j] of jobs) if (j.done && j.at < cutoff) jobs.delete(id);
}

/**
 * Start a clone, or return the one already running for this workspace.
 *
 * Returns immediately. A caller that asks twice — two tabs, a retry, a remount — joins the
 * job in flight instead of starting a second `git clone` into the same directory.
 */
export function startClone(
  userEmail: string,
  workspace: string,
  uri: string,
): CloneJob {
  sweep();
  const id = idFor(userEmail, workspace);
  const running = jobs.get(id);
  if (running && !running.done) return snapshot(running);

  const job: CloneJob & { at: number } = {
    id,
    workspace,
    done: false,
    failed: false,
    error: null,
    phase: "starting",
    percent: null,
    lines: [],
    at: Date.now(),
  };
  jobs.set(id, job);

  void cloneWorkspace(userEmail, workspace, uri, (p) => {
    job.phase = p.phase;
    job.percent = p.percent;
    job.lines.push(p.line);
    if (job.lines.length > MAX_LINES) job.lines.shift();
  })
    .then(() => {
      job.phase = "done";
      job.percent = 100;
    })
    .catch((e: Error) => {
      job.failed = true;
      job.error = e.message;
      job.phase = "failed";
    })
    .finally(() => {
      job.done = true;
      job.at = Date.now();
    });

  return snapshot(job);
}

export function cloneJob(id: string): CloneJob | null {
  const j = jobs.get(id);
  return j ? snapshot(j) : null;
}

// A copy, so a caller cannot hold a reference that keeps changing under it mid-response.
function snapshot(j: CloneJob): CloneJob {
  return { ...j, lines: [...j.lines] };
}
