// engineLink.ts — the connection half of the browser's engine client: dial, keep alive, reconnect
// with backoff, queue while down, stamp the session. It knows no reply but `whoami` as a ping;
// engineEvents.ts reads the frames, engine.ts is the client apps use. See docs/reliability.md.

import { Outbox } from "@studio/engine-protocol/decode";
import {
  DEFAULT_SESSION,
  type SessionId,
} from "@studio/engine-protocol/sessions";
import {
  backoffMs,
  ENGINE_CONNECT_DEADLINE_MS,
  ENGINE_IDLE_PING_MS,
  ENGINE_OUTBOX_MAX,
  ENGINE_OUTBOX_TTL_MS,
  ENGINE_PONG_TIMEOUT_MS,
  ENGINE_RECONNECT_MAX_MS,
} from "@studio/web-protocol";
import { pairFrameFor } from "./pairing.ts";
import { openSocket } from "./rtcSocket.ts";

/** Marks a stretch of work for a host that watches for stalls, returning its end callback — see docs/reliability.md. */
export type BeginActivity = (name: string) => () => void;
const noActivity: BeginActivity = () => () => {};

/** Add up work by name, for a host that watches for stalls — see apps/k7/frontend/docs/shell.md. */
export type Tally = (name: string, ms: number, bytes?: number) => void;
const noTally: Tally = () => {};

/** Where to connect, asked again before every attempt; null means "none right now" — see docs/reliability.md. */
export type EngineUrl = string | (() => string | null | Promise<string | null>);

type ConnCb = (connected: boolean) => void;
/** One binary audio frame, exactly as it arrived; `owned` when no other listener reads it, so it may be transferred. */
type StreamCb = (frame: ArrayBuffer, owned: boolean) => void;

export abstract class EngineLink {
  private ws?: WebSocket;
  // Held with the time it was queued, so a stale transport verb is dropped rather than replayed — see docs/reliability.md.
  private outbox = new Outbox(ENGINE_OUTBOX_MAX, ENGINE_OUTBOX_TTL_MS);
  private connCbs = new Set<ConnCb>();
  // Raw audio frames, handed on undecoded — @studio/engine-browser/stream is what knows how to read them.
  private streamCbs = new Set<StreamCb>();
  private closed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  /** Which attempt owns the client, bumped by every `connect()` so a late event schedules no second ladder — see docs/reliability.md. */
  private gen = 0;
  /** Consecutive failures, for the backoff. Reset by a socket that actually opened. */
  private attempt = 0;
  /** When anything last arrived — the only honest evidence the link still carries. */
  private lastInbound = 0;
  /** When the idle `whoami` went out, or 0 when none is outstanding. */
  private pingSentAt = 0;
  private keepaliveTimer?: ReturnType<typeof setInterval>;

  /** @param session which project on that engine this client drives — see `@studio/engine-protocol/docs/sessions.md`. */
  constructor(
    private readonly url: EngineUrl,
    private readonly beginActivity: BeginActivity = noActivity,
    protected readonly session: SessionId = DEFAULT_SESSION,
    private readonly tally: Tally = noTally,
  ) {}

  connect(): void {
    // A reconnect queued before dispose() must not resurrect the client — onclose's timer can still be pending.
    if (this.closed) return;
    const myGen = ++this.gen;
    void this.resolveUrl().then((url) => {
      // dispose(), or another connect(), landed while we were asking.
      if (this.closed || this.gen !== myGen) return;
      // No engine to reach yet. Not a failure — ask again, on the same ladder.
      if (!url) return this.retryLater(myGen);
      this.open(url, myGen);
    });
  }

  private async resolveUrl(): Promise<string | null> {
    if (typeof this.url === "string") return this.url;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // A lookup that never answers is no engine too: without a deadline the ladder would stop here for good.
      return await Promise.race([
        this.url(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), ENGINE_CONNECT_DEADLINE_MS);
        }),
      ]);
    } catch {
      // The caller's lookup failed — indistinguishable, from here, from no engine.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private open(url: string, myGen: number): void {
    let ws: WebSocket;
    try {
      ws = openSocket(url);
    } catch {
      // A malformed URL throws synchronously; a dead one does not. Both are just "not now".
      this.retryLater(myGen);
      return;
    }
    // Audio frames arrive as binary here; without this they surface as Blobs and die silently in the JSON parse.
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    // A dial that neither opens nor closes — a half-open path after a sleep — is ended here, so the ladder runs again.
    const deadline = setTimeout(() => {
      if (this.gen !== myGen || ws.readyState !== WebSocket.CONNECTING) return;
      try {
        ws.close();
      } catch {
        // Closing a socket that never opened may throw; it is being abandoned either way.
      }
      this.down(myGen);
    }, ENGINE_CONNECT_DEADLINE_MS);
    ws.onopen = () => {
      clearTimeout(deadline);
      if (this.gen !== myGen) return void ws.close();
      this.attempt = 0;
      this.lastInbound = Date.now();
      this.pingSentAt = 0;
      this.startKeepalive();
      // The device's key before anything: over the LAN the engine answers nothing else until it sees one (docs/pairing.md).
      const pair = pairFrameFor(url);
      if (pair) ws.send(pair);
      // Say we DRIVE this session first: the engine frees a project whose last driver left — see engine/k7-runtime/docs/sessions.md.
      this.sendNow({ type: "hello", role: "driver" });
      // What this client holds and a restarted engine does not — each layer adds its own.
      this.replay();
      this.flushOutbox();
      this.emitConn(true);
    };
    ws.onclose = () => {
      clearTimeout(deadline);
      if (this.gen !== myGen) return;
      this.down(myGen);
    };
    // `onclose` owns the retry, but this logs: it is the only place a refused dial says anything at all.
    ws.onerror = () => {
      if (this.gen === myGen) console.warn(`engine socket error: ${url}`);
    };
    ws.onmessage = (ev) => {
      if (this.gen !== myGen) return;
      // Anything at all proves the link carries, and the engine's own 20 Hz state frame usually does it.
      this.lastInbound = Date.now();
      this.pingSentAt = 0;
      // Binary is audio and never goes near the JSON path — it arrives at ~100 Hz.
      if (ev.data instanceof ArrayBuffer) {
        const owned = this.streamCbs.size === 1;
        for (const cb of this.streamCbs) cb(ev.data, owned);
        return;
      }
      // The clock starts BEFORE the parse: the type is not known until after it, so a span cannot
      // open there — which left the parse of a large frame attributed to nothing at all.
      const began = performance.now();
      const text = String(ev.data);
      let m: { type?: string };
      try {
        m = JSON.parse(text);
      } catch {
        this.tally("ws <unparseable>", performance.now() - began, text.length);
        return;
      }
      // Breadcrumb by message type, for whatever the host uses to spot a stall. See BeginActivity.
      const doneDispatch = this.beginActivity(`ws ${m.type ?? "?"}`);
      try {
        this.dispatch(m);
      } finally {
        doneDispatch();
      }
      // Parse AND dispatch, added up per type: a thread saturated by short frames has no span long
      // enough to name, and this is the line that names it anyway.
      this.tally(`ws ${m.type ?? "?"}`, performance.now() - began, text.length);
    };
  }

  /** The link went down — once per attempt, whoever noticed first; the generation bump makes the second notice a no-op. */
  private down(myGen: number): void {
    if (this.gen !== myGen) return;
    this.gen++; // this attempt is over; late events from its socket are now ignored
    this.stopKeepalive();
    this.emitConn(false);
    if (!this.closed) this.retryLater(this.gen);
  }

  /** Wait, then try again — doubling, jittered, capped. See docs/reliability.md. */
  private retryLater(myGen: number): void {
    if (this.closed || this.gen !== myGen) return;
    const step = backoffMs(this.attempt, ENGINE_RECONNECT_MAX_MS);
    this.attempt++;
    const wait = step / 2 + Math.random() * (step / 2);
    this.reconnectTimer = setTimeout(() => {
      if (this.gen === myGen) this.connect();
    }, wait);
  }

  /** Ask `whoami` when nothing has been said for a while — this protocol has no ping. See docs/reliability.md. */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      const quiet = Date.now() - this.lastInbound;
      if (this.pingSentAt) {
        if (Date.now() - this.pingSentAt > ENGINE_PONG_TIMEOUT_MS) {
          // Open by its own account, and deaf: drop it ourselves rather than wait for a `close` that is not coming.
          const gen = this.gen;
          this.ws?.close();
          this.down(gen);
        }
        return;
      }
      if (quiet > ENGINE_IDLE_PING_MS) {
        this.pingSentAt = Date.now();
        this.sendNow({ type: "whoami" });
      }
    }, ENGINE_PONG_TIMEOUT_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
    this.pingSentAt = 0;
  }

  /** Replay what is still worth replaying, oldest first, and drop the rest. */
  private flushOutbox(): void {
    for (const s of this.outbox.drain())
      if (this.ws?.readyState === WebSocket.OPEN)
        try {
          this.ws.send(s);
        } catch {
          // The link went again mid-replay: the rest is lost with it, as a blink's would be.
          break;
        }
  }

  dispose(): void {
    this.closed = true;
    this.gen++; // whatever is in flight stops belonging to anyone
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopKeepalive();
    this.ws?.close();
  }

  /** Raw audio frames. Decode with @studio/engine-browser/stream — see docs/streaming.md. */
  onStreamFrame(cb: StreamCb): () => void {
    this.streamCbs.add(cb);
    return () => this.streamCbs.delete(cb);
  }
  onConnected(cb: ConnCb): () => void {
    this.connCbs.add(cb);
    return () => this.connCbs.delete(cb);
  }

  protected send(o: object): void {
    const s = this.frame(o);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // A channel closing under us throws rather than refusing; the message waits like any other then.
      try {
        this.ws.send(s);
        return;
      } catch {}
    }
    this.outbox.push(s);
  }

  /** Send or drop — for what only means something on THIS socket, and must never be queued. */
  protected sendNow(o: object): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(this.frame(o));
    } catch {
      // Dropped, which is what this verb means when the link is not there.
    }
  }

  private frame(o: object): string {
    // Stamped at the ONE choke point every command goes through, and omitted when default so an old client's bytes stay identical.
    return JSON.stringify(this.session ? { session: this.session, ...o } : o);
  }
  private emitConn(c: boolean): void {
    for (const cb of this.connCbs) cb(c);
  }

  /** Read one parsed frame — the subclass's whole job. */
  protected abstract dispatch(m: { type?: string }): void;

  /** Resent on every open, after `hello` and before the queue; a layer calls `super.replay()` where its own order needs it. */
  protected replay(): void {}
}
