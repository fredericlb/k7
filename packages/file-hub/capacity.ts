// capacity.ts — how many file services this machine may run at once: `STUDIO_MAX_FILE_SERVICES` when
// set, else what the container's memory limit holds once the backend's reserve is taken off.
// The one thing a reader would get wrong: the budget is what a service USES, not its heap ceiling,
// which bounds one runaway and is paid for by the reserve. See docs/fileHub.md.

import { readFileSync } from "node:fs";

/** The cap where no memory limit is known: a desktop, a phone, a server with no cgroup limit. */
export const MAX_INSTANCES = 50;
/** What the backend, its ffmpeg and chromium children and one runaway service keep, outside every budget. */
export const RESERVE_MB = 1536;
/** What one account's service is counted at: an editing session's resident set, with room to grow. */
export const BUDGET_MB = 384;
/** An instance nobody called for this long is stopped: a restart costs a second, a slot held costs a service's memory. */
export const IDLE_MS = 10 * 60_000;
/** Node's resident set beyond its old space: code, new space, buffers. */
const NODE_OVERHEAD_MB = 128;

/** cgroup v2 first, then v1; a value past this is v1's way of saying "no limit". */
const CGROUP_FILES = [
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory/memory.limit_in_bytes",
];
const UNLIMITED_FLOOR = 2 ** 60;

/** The container's memory limit in bytes, or null when there is none or no cgroup to read. */
export function cgroupMemoryLimit(
  read: (path: string) => string = (p) => readFileSync(p, "utf8"),
): number | null {
  for (const path of CGROUP_FILES) {
    let text: string;
    try {
      text = read(path).trim();
    } catch {
      continue;
    }
    if (text === "max") return null;
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0 || n >= UNLIMITED_FLOOR) return null;
    return n;
  }
  return null;
}

/** The cap: the override, else (limit − reserve) / budget, between 1 and MAX_INSTANCES. */
export function instanceCap(
  env: NodeJS.ProcessEnv = process.env,
  limitBytes: number | null = cgroupMemoryLimit(),
): number {
  const override = Number(env.STUDIO_MAX_FILE_SERVICES);
  if (Number.isInteger(override) && override > 0) return override;
  if (limitBytes === null) return MAX_INSTANCES;
  const heap = Number(env.STUDIO_FILE_SERVICE_HEAP_MB);
  const budget =
    Number.isInteger(heap) && heap > 0
      ? Math.min(BUDGET_MB, heap + NODE_OVERHEAD_MB)
      : BUDGET_MB;
  const free = limitBytes / 2 ** 20 - RESERVE_MB;
  return Math.max(1, Math.min(MAX_INSTANCES, Math.floor(free / budget)));
}
