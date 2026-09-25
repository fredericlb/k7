// machineLog.ts — the Logs panel's lines, which are the ENGINE machine's: this server runs no
// engine, so it asks the bound machine over the jobs channel. No machine bound, or one that does
// not answer, reads as an empty log rather than an error — the panel polls, and will catch up.

import { JobError } from "@studio/engine-tunnel/jobs-client";
import { askBoundMachine } from "./boundMachine.ts";

export interface LogChunk {
  offset: number;
  lines: string[];
}

const EMPTY: LogChunk = { offset: 0, lines: [] };

/** With `offset`, the new complete lines since it; without one, the last `tail` lines and the end offset. */
export async function boundMachineLog(opts: {
  offset?: number;
  tail?: number;
}): Promise<LogChunk> {
  try {
    const reply = await askBoundMachine({ type: "log", ...opts }, "log");
    return (reply?.raw as LogChunk | undefined) ?? EMPTY;
  } catch (e) {
    if (!(e instanceof JobError)) throw e;
    return EMPTY;
  }
}
