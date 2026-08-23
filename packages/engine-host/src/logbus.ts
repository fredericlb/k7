// logbus.ts — pipe the engine's and the file service's output into ONE tagged, timestamped
// log, which the tray opens and the web UI's Logs panel serves. The `HH:MM:SS [tag] text`
// format is load-bearing (the panel polls by byte offset) and we only ever APPEND — the
// tray owns truncation. Full rationale: docs/supervisorPolicy.md.

import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import type { Readable } from "node:stream";
import { mergedLogPath, studioDir } from "@studio/engine-client/paths";

let stream: WriteStream | null | undefined;

function out(): WriteStream | null {
  if (stream !== undefined) return stream;
  try {
    mkdirSync(studioDir(), { recursive: true });
    stream = createWriteStream(mergedLogPath(), { flags: "a" });
    // A log must never take the process down: an unwritable file becomes silence, not an unhandled 'error' event.
    stream.on("error", () => {});
  } catch {
    stream = null;
  }
  return stream;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Write one tagged, timestamped line. `tag` is the source ("engine" / "file"). */
export function line(tag: string, text: string): void {
  out()?.write(`${stamp()} [${tag}] ${text}\n`);
}

/** Drain a child's output into the merged log under `tag`, line-buffered by hand; draining is not optional, since a full pipe blocks the child. */
export function pump(reader: Readable, tag: string): void {
  let rest = "";
  reader.setEncoding("utf8");
  reader.on("data", (chunk: string) => {
    const parts = (rest + chunk).split(/\r?\n/);
    rest = parts.pop() ?? ""; // the trailing partial line waits for the next chunk
    for (const l of parts) line(tag, l);
  });
  reader.on("end", () => {
    if (rest) line(tag, rest);
    rest = "";
  });
  reader.on("error", () => {}); // a broken pipe means the process is gone; nothing to say
}
