// serviceLog.ts — this file service's OWN log, kept for st0's Logs panel. Everything the process
// writes through `console` is still written where it always was (the hub's output, Tilt's pane),
// and ALSO kept here, the last few hundred lines, numbered, so the panel can ask "what since N".
//
// One process per account (packages/file-hub/docs/fileHub.md), so what one account's panel reads
// is its own service's lines and nobody else's. The engine machine's `.studio.log` is the other
// half of the panel, fetched over the tunnel (machineLog.ts). See docs/serviceLog.md.

import { format } from "node:util";

/** One line of this service's log, as the panel draws it. */
export interface ServiceLogLine {
  /** Monotonic within this process: the panel's cursor. */
  seq: number;
  /** Epoch ms. */
  t: number;
  level: "info" | "warn" | "error";
  text: string;
}

/** How many lines are kept — a panel opened after a burst gets the end of it, not all of it. */
export const SERVICE_LOG_LINES = 1000;

const lines: ServiceLogLine[] = [];
let seq = 0;
let installed = false;

/** Keep one line; a multi-line message is kept whole, as one entry. */
export function keepServiceLine(
  level: ServiceLogLine["level"],
  text: string,
): void {
  lines.push({ seq: ++seq, t: Date.now(), level, text });
  if (lines.length > SERVICE_LOG_LINES)
    lines.splice(0, lines.length - SERVICE_LOG_LINES);
}

/** Tee `console` into the buffer, once per process; the original output is left exactly as it was. */
export function installServiceLog(): void {
  if (installed) return;
  installed = true;
  const tee =
    (level: ServiceLogLine["level"], original: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      original(...args);
      try {
        keepServiceLine(level, format(...args));
      } catch {
        /* a value that will not format must not take the log call down with it */
      }
    };
  console.log = tee("info", console.log.bind(console));
  console.info = tee("info", console.info.bind(console));
  console.warn = tee("warn", console.warn.bind(console));
  console.error = tee("error", console.error.bind(console));
}

/**
 * The lines after `after`, and the cursor to ask with next. With no `after`, the last `tail`.
 *
 * A cursor from a PREVIOUS process (the service restarted, `seq` began again) is higher than
 * anything here: that answers from the start rather than nothing forever.
 */
export function serviceLogSince(
  after?: number,
  tail = 300,
): { seq: number; lines: ServiceLogLine[] } {
  if (after === undefined || after > seq)
    return { seq, lines: lines.slice(-tail) };
  return { seq, lines: lines.filter((l) => l.seq > after) };
}
