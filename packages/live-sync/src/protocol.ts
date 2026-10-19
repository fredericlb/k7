// protocol.ts — the messages between a replica and the relay, one JSON object per WebSocket frame.
// One socket carries every workspace of an account; each message names the one it is about.
// See ../docs/sync.md.

import {
  type Batch,
  type Conflict,
  type FileOp,
  isKnownOpKind,
  RETIRED_OP_KINDS,
  type Sequenced,
} from "./ops.ts";
import { isSyncPath } from "./path.ts";

/** The level of this build's ops and frames; what bumps it is ../docs/sync.md, "Versions". */
export const SYNC_PROTO = 2;
/** The oldest replica level a relay of this build still serves: level 1 sent `yaml` ops. */
export const SYNC_PROTO_MIN = 2;
/** The version stamped on every log entry and saved room state this build writes. */
export const LOG_V = 1;

/** Replica to relay; a hello without `proto` is a level-1 replica. */
export type ToRelay =
  | {
      t: "hello";
      workspace: string;
      since: number;
      proto: number;
      build?: string;
    }
  | { t: "batch"; workspace: string; batch: Batch };

/** Why a hello is refused: the replica must be updated, or the server is older than it. */
export type RefusalReason = "update" | "server-older";

/** The relay's answer to a hello it will not serve: the levels it accepts, so the replica can say which side to update. */
export interface Refused {
  t: "refused";
  workspace: string;
  reason: RefusalReason;
  min: number;
  server: number;
}

/** Why a frame was not read: not a sync frame at all, an op kind this server lacks, or a message it does not know. */
export type FrameError = "malformed" | "unknown-op" | "unknown-message";

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
  | Refused
  | { t: "error"; workspace?: string; error: string; reason?: FrameError };

/** The refusal a relay at `server`, accepting from `min`, answers a hello at `proto` with, or null when it serves it. */
export function protoRefusal(
  workspace: string,
  proto: number,
  server = SYNC_PROTO,
  min = SYNC_PROTO_MIN,
): Refused | null {
  if (proto < min)
    return { t: "refused", workspace, reason: "update", min, server };
  if (proto > server)
    return { t: "refused", workspace, reason: "server-older", min, server };
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const optText = (v: unknown): boolean =>
  v === undefined || v === null || typeof v === "string";

/** One k7x path op: a key path of strings, and the value's k7x source when it sets. */
function isPathOp(v: unknown): boolean {
  if (!isObject(v) || !Array.isArray(v.path) || !optText(v.was)) return false;
  if (!v.path.every((s) => typeof s === "string")) return false;
  if (v.op === "delete") return true;
  return v.op === "set" && typeof v.k7x === "string" && optText(v.after);
}

/** One file's op, its path confined to the workspace (path.ts). */
export function isFileOp(v: unknown): v is FileOp {
  if (!isObject(v) || !isSyncPath(v.file)) return false;
  switch (v.kind) {
    case "k7x":
      return Array.isArray(v.ops) && v.ops.every(isPathOp);
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

/** A frame read, or why it was not: the relay trusts the socket, not the payload. */
export type ReadFrame =
  | { msg: ToRelay }
  | { reason: FrameError; error: string; workspace?: string };

/** The first op kind in a batch-looking value that this build does not know, or null. */
function unknownKind(batch: unknown): string | null {
  if (!isObject(batch) || !Array.isArray(batch.ops)) return null;
  for (const op of batch.ops)
    if (isObject(op) && !isKnownOpKind(op.kind)) return String(op.kind);
  return null;
}

/** A frame from a replica, read whole before anything uses it. */
export function readToRelay(raw: string): ReadFrame {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { reason: "malformed", error: "not JSON" };
  }
  if (!isObject(v)) return { reason: "malformed", error: "not an object" };
  if (typeof v.workspace !== "string" || !v.workspace)
    return { reason: "malformed", error: "no workspace named" };
  const workspace = v.workspace;
  if (v.t === "hello") {
    // No `proto` is a replica from before the field: level 1, below SYNC_PROTO_MIN, so it is told to update.
    const proto = v.proto ?? 1;
    if (typeof v.since !== "number")
      return { reason: "malformed", error: "hello without since", workspace };
    if (typeof proto !== "number" || !Number.isInteger(proto) || proto < 1)
      return {
        reason: "malformed",
        error: "hello with a bad proto",
        workspace,
      };
    const build = typeof v.build === "string" ? v.build : undefined;
    return {
      msg: { t: "hello", workspace, since: v.since, proto, build },
    };
  }
  if (v.t === "batch") {
    if (isBatch(v.batch))
      return { msg: { t: "batch", workspace, batch: v.batch } };
    const kind = unknownKind(v.batch);
    if (kind === null)
      return { reason: "malformed", error: "batch malformed", workspace };
    return {
      reason: "unknown-op",
      error: RETIRED_OP_KINDS.includes(kind)
        ? `op kind "${kind}" retired: the replica's k7 is older than this server's and must be updated`
        : `op kind "${kind}" unknown here: this server's k7 is older than the replica's`,
      workspace,
    };
  }
  return {
    reason: "unknown-message",
    error: `message "${String(v.t)}" unknown here`,
    workspace,
  };
}

/** A frame from a replica, or null when it is not one. */
export function parseToRelay(raw: string): ToRelay | null {
  const read = readToRelay(raw);
  return "msg" in read ? read.msg : null;
}
