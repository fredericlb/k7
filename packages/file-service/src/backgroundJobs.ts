// backgroundJobs.ts — work a COMMAND starts and does not wait for: a video transcode, minutes
// long, which must not hold the `/command` request open. One tag runs once at a time, so a verb
// run twice joins the first run rather than encoding the same file twice. A job reports through
// what it WRITES, through the log, and as a listed process the project bar shows (processes.ts).
// See docs/background.md.

import { guard } from "./background.ts";
import { runAsProcess, tagLabel } from "./processes.ts";

/** A job the service is running, by tag; dropped once it ends, since its result is on disk. */
const running = new Map<string, number>();

/** Start `work` under `tag` unless a job of that tag is already running; true when it started. */
export function runInBackground(
  tag: string,
  work: () => Promise<string>,
  log: (line: string) => void = (l) => console.log(l),
): boolean {
  if (running.has(tag)) return false;
  running.set(tag, Date.now());
  guard(
    tag,
    runAsProcess(tagLabel(tag), work)
      .then((line) => log(`   ✓ ${line}`))
      .finally(() => running.delete(tag)),
  );
  return true;
}
