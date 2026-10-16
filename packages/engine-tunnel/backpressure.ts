// backpressure.ts — what a relay does with a frame for a peer that stopped reading: send it,
// drop it, or give up on the peer. Past SOFT_LIMIT_BYTES unsent, the frames a newer one replaces
// (an audio broadcast frame, a `state`, a meter feed) are dropped; past HARD_LIMIT_BYTES of what
// may not be dropped, the peer is closed. A reply is never dropped. See docs/backpressure.md.

import { STREAM_MAGIC } from "@studio/engine-protocol/stream";

/** Unsent bytes past which a replaceable frame is dropped rather than queued. */
export const SOFT_LIMIT_BYTES = 8 * 1024 * 1024;
/** Unsent bytes past which the peer is given up on: what is queued then can only be replies. */
export const HARD_LIMIT_BYTES = 64 * 1024 * 1024;
/** The close code an overrun peer gets — 1013, "try again later". */
export const OVERLOAD_CLOSE = 1013;

/** The engine's text pushes that a newer one of the same kind replaces (engine/k7-runtime/docs/protocol.md). */
export const DROPPABLE_TYPES: ReadonlySet<string> = new Set([
  "state",
  "io-levels",
  "plugin-params-live",
]);
/** A text frame larger than this is never parsed to find its type, and so never dropped. */
const MAX_PARSED_BYTES = 64 * 1024;

export type Payload = Buffer | ArrayBuffer | Buffer[] | string;

export interface Limits {
  soft: number;
  hard: number;
}
const DEFAULT_LIMITS: Limits = {
  soft: SOFT_LIMIT_BYTES,
  hard: HARD_LIMIT_BYTES,
};

function firstBytes(d: Payload): Uint8Array | null {
  if (typeof d === "string") return null;
  if (Array.isArray(d)) return d[0] ?? null;
  return d instanceof ArrayBuffer ? new Uint8Array(d) : d;
}

function textOf(d: Payload): string {
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return Buffer.concat(d).toString("utf8");
  return Buffer.from(d instanceof ArrayBuffer ? new Uint8Array(d) : d).toString(
    "utf8",
  );
}

const sizeOf = (d: Payload): number =>
  typeof d === "string"
    ? d.length
    : Array.isArray(d)
      ? d.reduce((n, b) => n + b.length, 0)
      : d.byteLength;

/** Whether a newer frame replaces this one: an audio broadcast frame, or one of DROPPABLE_TYPES. */
export function isDroppable(data: Payload, binary: boolean): boolean {
  if (binary) {
    const b = firstBytes(data);
    if (!b || b.byteLength < 4) return false;
    return (
      new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true) ===
      STREAM_MAGIC
    );
  }
  if (sizeOf(data) > MAX_PARSED_BYTES) return false;
  try {
    const m = JSON.parse(textOf(data)) as { type?: unknown };
    return typeof m?.type === "string" && DROPPABLE_TYPES.has(m.type);
  } catch {
    return false;
  }
}

/** What to do with a frame for a peer with `buffered` bytes unsent; the frame is classified only under pressure. */
export function admit(
  buffered: number,
  data: Payload,
  binary: boolean,
  limits: Limits = DEFAULT_LIMITS,
): "send" | "drop" | "close" {
  if (buffered < limits.soft) return "send";
  if (isDroppable(data, binary)) return "drop";
  return buffered >= limits.hard ? "close" : "send";
}

/** A peer the relay sends to: a `ws` socket or a tunnel channel. */
export interface Peer {
  readonly bufferedAmount: number;
  send(data: Payload, opts: { binary: boolean }): void;
}

/** Frames held before the far end is connected, at most this many… */
export const MAX_HELD_FRAMES = 256;
/** …and this many bytes: a client that sends more before its peer answers is closed. */
export const MAX_HELD_BYTES = 8 * 1024 * 1024;

/** A bounded queue of frames waiting for a peer to connect; `push` answers false past its bounds. */
export class HeldFrames<T extends Payload = Payload> {
  private frames: { data: T; binary: boolean }[] = [];
  private bytes = 0;

  push(data: T, binary: boolean): boolean {
    const n = sizeOf(data);
    if (
      this.frames.length >= MAX_HELD_FRAMES ||
      this.bytes + n > MAX_HELD_BYTES
    )
      return false;
    this.frames.push({ data, binary });
    this.bytes += n;
    return true;
  }

  /** Every frame held, in order, and the queue emptied. */
  drain(): { data: T; binary: boolean }[] {
    this.bytes = 0;
    return this.frames.splice(0);
  }
}

/** Send through `admit`; on "close", `overrun` is called and nothing is sent. */
export function sendBounded(
  to: Peer,
  data: Payload,
  binary: boolean,
  overrun: () => void,
  limits?: Limits,
): "send" | "drop" | "close" {
  const v = admit(to.bufferedAmount, data, binary, limits);
  if (v === "send") to.send(data, { binary });
  else if (v === "close") overrun();
  return v;
}
