// logs.ts — serve the tray's merged engine + file-service log (~/.st0/.studio.log)
// to the web UI's Logs panel: seed with a tail, then poll by byte offset. Falls back to
// the CLI's engine-only log when there's no tray, and to nothing when there's neither.

import { readFileSync, statSync } from "node:fs";
import { engineLogPath, mergedLogPath } from "@studio/engine-client/paths";

// Merged first, then the CLI's engine-only log; both names come from the contract module.
const CANDIDATES = [mergedLogPath(), engineLogPath()];

function logFile(): string | null {
  for (const p of CANDIDATES) {
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* not there — try the next candidate */
    }
  }
  return null;
}

export interface LogChunk {
  offset: number; // byte position to pass back for the next incremental read
  lines: string[]; // whole log lines (no trailing newline)
}

function splitLines(s: string): string[] {
  const lines = s.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// With `offset`, the NEW complete lines since it; without one, the last `tail` lines and the end offset.
export function readLog(opts: { offset?: number; tail?: number }): LogChunk {
  const p = logFile();
  if (!p) return { offset: 0, lines: [] };
  let buf: Buffer;
  try {
    buf = readFileSync(p);
  } catch {
    return { offset: 0, lines: [] };
  }
  const size = buf.length;

  if (opts.offset != null && opts.offset >= 0 && opts.offset <= size) {
    const lastNl = buf.subarray(opts.offset).lastIndexOf(0x0a); // '\n'
    if (lastNl < 0) return { offset: opts.offset, lines: [] }; // nothing complete yet
    const end = opts.offset + lastNl + 1;
    return {
      offset: end,
      lines: splitLines(buf.subarray(opts.offset, end).toString("utf8")),
    };
  }

  const all = splitLines(buf.toString("utf8"));
  const n = Math.max(1, opts.tail ?? 300);
  return { offset: size, lines: all.slice(-n) };
}
