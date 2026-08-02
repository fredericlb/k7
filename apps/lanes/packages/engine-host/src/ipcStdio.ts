// ipcStdio.ts — the NDJSON channel to the tray, plus the stdout quarantine that keeps it
// readable. IMPORTING THIS HAS A SIDE EFFECT: it reassigns process.stdout.write to route
// everything to stderr, so no console.log (ours or a dependency's) can corrupt the frame
// stream. Must be the FIRST thing main.ts imports.

import { createInterface } from "node:readline";
import type { HostCommand, HostEvent } from "./hostProtocol.ts";

// Captured before the reassignment below and never handed out; `bind` matters, or the write loses its receiver.
const writeFrame: (chunk: string) => boolean = process.stdout.write.bind(
  process.stdout,
) as (chunk: string) => boolean;

// Everything that thought it wrote to stdout now goes to stderr, which the tray merges. Deliberately not a
// no-op: swallowing our own diagnostics would make a misbehaving host silent as well as broken.
process.stdout.write = ((
  chunk: string | Uint8Array,
  encoding?: unknown,
  cb?: unknown,
) =>
  (
    process.stderr.write as (
      c: string | Uint8Array,
      e?: unknown,
      cb?: unknown,
    ) => boolean
  )(chunk, encoding, cb)) as typeof process.stdout.write;

/** Send one event to the tray. The only writer to the real stdout in this process. */
export function emit(event: HostEvent): void {
  // No pretty-printing, ever: a newline inside a frame ends it early and the tray parses the rest as invalid.
  writeFrame(`${JSON.stringify(event)}\n`);
}

/**
 * Read commands from the tray until stdin ends, then call `onEnd`.
 *
 * The END is as important as the messages. On Unix there is no job-object equivalent,
 * so this is the whole teardown mechanism: when the tray dies — quit, crash, or
 * `kill -9` — the OS closes the write end of the pipe, `end` fires here, and the host
 * tears the stack down instead of becoming a ghost engine in the picker with no UI left
 * to stop it.
 */
export function listen(
  onCommand: (cmd: HostCommand) => void,
  onEnd: () => void,
): void {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      // A malformed line is the tray's bug, not a reason to die: log it and keep the channel open.
      process.stderr.write(`[host] ignoring unparseable command: ${text}\n`);
      return;
    }
    const cmd = msg as Partial<HostCommand>;
    if (cmd?.t !== "cmd" || typeof cmd.cmd !== "string") return;
    onCommand({
      t: "cmd",
      id: typeof cmd.id === "number" ? cmd.id : 0,
      cmd: cmd.cmd,
      ...(typeof cmd.arg === "string" ? { arg: cmd.arg } : {}),
    });
  });
  rl.on("close", onEnd);
}
