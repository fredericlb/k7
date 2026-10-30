// relayGate.ts — what the relay lets through for an account holding NO claim on the engine: the
// probe a picker needs (whoami, this device's key, the plugin list and its scan) and their answers, nothing
// else. Anything more is HELD while a claim may still be landing — a page opens its socket and
// claims at the same moment — and the socket is closed when none comes. The claim is asked again
// on every browser frame, so a takeover stops the loser at its next one; the engine's stream reuses
// a claim seen in the last CLAIM_REUSE_MS. A `whoami` loses its token for an account that may not
// use the engine (docs/ownership.md). See docs/proxy.md.

import type { RawData } from "ws";

/** What a browser may send before it holds a claim: what `probe.ts` and `compat.ts` send. */
const PROBE_REQUESTS: ReadonlySet<string> = new Set([
  "whoami",
  "pair",
  "list-plugins",
  // Where the engine's plugin scan stands — what the home page follows (engine-browser's scanWatch.ts).
  "plugin-scan",
]);
/** What an engine may answer to a browser without a claim. */
const PROBE_ANSWERS: ReadonlySet<string> = new Set([
  "whoami",
  "plugins",
  "plugin-scan",
  "error",
]);
/** How long frames past the probe wait for a claim before the socket is closed. */
const CLAIM_GRACE_MS = 10_000;
/** The close code a socket gets when it never held a claim — 4403, the 403 of a WebSocket. */
export const NO_CLAIM_CLOSE = 4403;
const POLL_MS = 200;
/** How long a claim seen holding is trusted for the engine's frames: its audio comes far faster than that. */
const CLAIM_REUSE_MS = 250;
const MAX_HELD_FRAMES = 256;
const MAX_HELD_BYTES = 8 * 1024 * 1024;
/** A probe is a few bytes; nothing larger is parsed to find its type. */
const MAX_PARSED_BYTES = 64 * 1024;

export interface Frame {
  data: RawData;
  binary: boolean;
}

export interface GateSinks {
  /** Whether the ticket's account holds a live claim on this engine now. */
  holds(): boolean;
  /** Whether the ticket's account may use this engine, and so read its token. */
  mayReadToken(): boolean;
  toEngine(f: Frame): void;
  close(code: number, reason: string): void;
}

const bytesOf = (d: RawData): number =>
  Array.isArray(d)
    ? d.reduce((n, b) => n + b.length, 0)
    : (d as Buffer | ArrayBuffer).byteLength;

/** A small text frame as a JSON object, or null for a binary frame, a large one, or anything else. */
function parsed(f: Frame): Record<string, unknown> | null {
  if (f.binary || bytesOf(f.data) > MAX_PARSED_BYTES) return null;
  const d = f.data;
  const text = Array.isArray(d)
    ? Buffer.concat(d).toString("utf8")
    : Buffer.from(d as ArrayBuffer).toString("utf8");
  try {
    const m = JSON.parse(text) as unknown;
    return m && typeof m === "object" && !Array.isArray(m)
      ? (m as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A text frame's `type`, or null for a binary frame, a large one, or one that is not a JSON object. */
function frameType(f: Frame): string | null {
  const m = parsed(f);
  return typeof m?.type === "string" ? m.type : null;
}

/** The frame without the engine token a `whoami` carries; any other frame as it came. */
function withoutToken(f: Frame): Frame {
  const m = parsed(f);
  if (m?.type !== "whoami" || !("token" in m)) return f;
  const { token: _token, ...rest } = m;
  return { data: Buffer.from(JSON.stringify(rest)), binary: false };
}

export class RelayGate {
  private held: Frame[] = [];
  private heldBytes = 0;
  private since = 0;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  /** When `holds()` last answered true, for the engine's frames alone. */
  private heldAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly sinks: GateSinks,
    private readonly graceMs = CLAIM_GRACE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** A frame from the browser: forwarded, held for a claim, or the end of the socket. */
  fromClient(f: Frame): void {
    if (this.closed) return;
    if (this.sinks.holds()) {
      this.flush();
      this.sinks.toEngine(f);
      return;
    }
    // Order is kept: once one frame waits, every later one waits behind it, probe or not.
    if (!this.held.length && PROBE_REQUESTS.has(frameType(f) ?? "")) {
      this.sinks.toEngine(f);
      return;
    }
    this.hold(f);
  }

  /** The frame from the engine as it may reach the browser, or null when it may not. */
  fromEngine(f: Frame): Frame | null {
    if (this.closed) return null;
    const pass = this.holdsRecently() || PROBE_ANSWERS.has(frameType(f) ?? "");
    if (!pass) return null;
    // Only a text `whoami` carries the token, so a binary frame needs no second question.
    if (f.binary) return f;
    return this.sinks.mayReadToken() ? f : withoutToken(f);
  }

  /** `holds()`, its true answer reused for CLAIM_REUSE_MS; a false one is asked again each time. */
  private holdsRecently(): boolean {
    const now = this.now();
    if (now - this.heldAt < CLAIM_REUSE_MS) return true;
    if (!this.sinks.holds()) return false;
    this.heldAt = now;
    return true;
  }

  dispose(): void {
    this.closed = true;
    this.stopTimer();
    this.held = [];
  }

  private hold(f: Frame): void {
    const size = bytesOf(f.data);
    if (
      this.held.length >= MAX_HELD_FRAMES ||
      this.heldBytes + size > MAX_HELD_BYTES
    ) {
      this.shut("too much sent before claiming this engine");
      return;
    }
    if (!this.held.length) {
      this.since = this.now();
      this.timer = setInterval(() => this.tick(), POLL_MS);
      this.timer.unref?.();
    }
    this.held.push(f);
    this.heldBytes += size;
  }

  private tick(): void {
    if (this.closed) this.stopTimer();
    else if (this.sinks.holds()) this.flush();
    else if (this.now() - this.since >= this.graceMs)
      this.shut("no claim on this engine: select it before driving it");
  }

  private flush(): void {
    this.stopTimer();
    const held = this.held.splice(0);
    this.heldBytes = 0;
    for (const f of held) this.sinks.toEngine(f);
  }

  private shut(reason: string): void {
    this.dispose();
    this.sinks.close(NO_CLAIM_CLOSE, reason);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
