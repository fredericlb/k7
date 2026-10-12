// mergedLog.ts — the tray's end of `<state>/.studio.log`, which the supervisor writes and the web Logs panel polls.
// The line format `HH:MM:SS [tag] text` is that panel's contract, so it is the supervisor's and not electron-shell's.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

let file: string | null = null;

/** Truncate once per session, BEFORE the supervisor opens it: a relaunched supervisor must not wipe the crash it logged. */
export function openMergedLog(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  file = path;
}

/** One tagged line, appended whole so it interleaves with the supervisor's rather than tearing. */
export function hostLine(text: string, tag = "host"): void {
  const now = new Date();
  const ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const out = `${ts} [${tag}] ${text}\n`;
  if (!file) return void process.stdout.write(out);
  try {
    appendFileSync(file, out);
  } catch {
    /* a log must never take the app down */
  }
}
