// protocol.ts — the messages between a replica and the relay, one JSON object per WebSocket frame.
// One socket carries every workspace of an account; each message names the one it is about.
// See ../docs/sync.md.

import type { Batch, Conflict, FileOp, Sequenced } from "./ops.ts";
import { isSyncPath } from "./path.ts";

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
  typeof v === "object" && v !== null && !Array.isArray(v);

const optText = (v: unknown): boolean =>
  v === undefined || v === null || typeof v === "string";

/** One YAML or k7x path op: a key path of strings, and the value source `body` names when it sets. */
function isPathOp(v: unknown, body: "yaml" | "k7x"): boolean {
  if (!isObject(v) || !Array.isArray(v.path) || !optText(v.was)) return false;
  if (!v.path.every((s) => typeof s === "string")) return false;
  if (v.op === "delete") return true;
  return v.op === "set" && typeof v[body] === "string" && optText(v.after);
}

/** One file's op, its path confined to the workspace (path.ts). */
export function isFileOp(v: unknown): v is FileOp {
  if (!isObject(v) || !isSyncPath(v.file)) return false;
  switch (v.kind) {
    case "yaml":
    case "k7x": {
      const body = v.kind;
      return Array.isArray(v.ops) && v.ops.every((o) => isPathOp(o, body));
    }
    case "text":
      return typeof v.text === "string" && optText(v.was);
    case "remove":
      return optText(v.was);
    default:
      return false;
  }
}

/** A batch whose every field has the type ops.ts gives it. */
export function isBatch(v: unknown): v is Batch {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.replica === "string" &&
    typeof v.local === "number" &&
    typeof v.ts === "number" &&
    typeof v.label === "string" &&
    Array.isArray(v.ops) &&
    v.ops.every(isFileOp) &&
    (v.resolves === undefined ||
      (Array.isArray(v.resolves) &&
        v.resolves.every((id) => typeof id === "string"))) &&
    (v.ends === undefined || v.ends === true)
  );
}

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
  if (v.t === "hello" && typeof v.since === "number")
    return { t: "hello", workspace: v.workspace, since: v.since };
  if (v.t === "batch" && isBatch(v.batch))
    return { t: "batch", workspace: v.workspace, batch: v.batch };
  return null;
}
