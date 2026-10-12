// protocol.ts — the messages between a replica and the relay, one JSON object per WebSocket frame.
// One socket carries every workspace of an account; each message names the one it is about.
// See ../docs/sync.md.

import type { Batch, Conflict, Sequenced } from "./ops.ts";

/** Replica to relay. */
export type ToRelay =
  | { t: "hello"; workspace: string; since: number }
  | { t: "batch"; workspace: string; batch: Batch };

/** Relay to replica. `welcome` answers `hello` with the open conflicts; a `seq` follows for every batch ordered, the replica's own included. */
export type FromRelay =
  | { t: "welcome"; workspace: string; mode: "seed" }
  | {
      t: "welcome";
      workspace: string;
      mode: "entries";
      head: number;
      conflicts: Conflict[];
    }
  | {
      t: "welcome";
      workspace: string;
      mode: "snapshot";
      head: number;
      files: Record<string, string>;
      conflicts: Conflict[];
    }
  | { t: "seq"; workspace: string; entry: Sequenced }
  | { t: "error"; workspace?: string; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** A frame from a replica, or null when it is not one: the relay trusts the socket, not the payload. */
export function parseToRelay(raw: string): ToRelay | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(v) || typeof v.workspace !== "string" || !v.workspace)
    return null;
  if (v.t === "hello" && typeof v.since === "number") return v as ToRelay;
  if (
    v.t === "batch" &&
    isObject(v.batch) &&
    typeof v.batch.id === "string" &&
    Array.isArray(v.batch.ops) &&
    (v.batch.resolves === undefined ||
      (Array.isArray(v.batch.resolves) &&
        v.batch.resolves.every((id) => typeof id === "string")))
  )
    return v as ToRelay;
  return null;
}
