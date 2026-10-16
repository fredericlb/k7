// hubTunnel.ts — ONE supervisor's tunnel as the hub sees it: the channels it carries and the
// file requests it makes. The hub (hub.ts) owns the set of these; this owns one socket.
// Each channel's unsent bytes are counted apart, so the one a stalled reader backs up is closed
// alone; uploads are capped in number, size, rate and idleness. See docs/tunnel.md.

import { WebSocket } from "ws";
import { HARD_LIMIT_BYTES } from "./backpressure.ts";
import { type ChannelSink, TunnelChannel } from "./channel.ts";
import { drained } from "./drain.ts";
import {
  asBuffer,
  type BinaryHeader,
  type ChannelKind,
  decodeBinary,
  encodeBinary,
  type HubMessage,
  parseAgentMessage,
  type TunnelRoot,
} from "./frames.ts";
import {
  readFileChunks,
  statPaths,
  Upload,
  type UploadLimits,
  uploadLimits,
} from "./hubFiles.ts";

interface Carried {
  channel: TunnelChannel;
  roots: TunnelRoot[];
  /** Bytes handed to the socket for this channel and not yet written out. */
  unsent: number;
}

interface Uploading {
  chain: Promise<Upload | null>;
  bytes: number;
  idle?: NodeJS.Timeout;
}

/** Request ids of refused uploads remembered, so their later chunks are not taken for a new upload. */
const MAX_REFUSED = 256;
const HOUR_MS = 3_600_000;

export class HubTunnel implements ChannelSink {
  private readonly channels = new Map<number, Carried>();
  private readonly uploads = new Map<number, Uploading>();
  private readonly refused = new Set<number>();
  private readonly limits: UploadLimits;
  private hour = { start: 0, bytes: 0 };
  private readonly offers = new Map<
    number,
    { ok: (sdp: string) => void; ko: (e: Error) => void }
  >();
  private nextReq = 1;
  private nextCh = 1;
  /** Cleared by every ping, set by every pong: a tunnel that misses one is dead. */
  alive = true;

  constructor(
    readonly engineId: string,
    readonly ws: WebSocket,
    private readonly log: (msg: string) => void,
    limits: Partial<UploadLimits> = {},
    private readonly channelLimit = HARD_LIMIT_BYTES,
  ) {
    this.limits = uploadLimits(limits);
    // A throw in a socket listener ends the server, and a tunnel needs no account: anything odd drops this tunnel alone.
    ws.on("message", (data, isBinary) => {
      try {
        if (isBinary) this.onBinary(asBuffer(data as Buffer));
        else this.onText(asBuffer(data as Buffer).toString("utf8"));
      } catch (e) {
        this.log(`${engineId} bad frame: ${(e as Error).message}`);
        ws.terminate();
      }
    });
    ws.on("pong", () => {
      this.alive = true;
    });
  }

  private tell(m: HubMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  sendText(ch: number, text: string): void {
    this.sendCounted(ch, JSON.stringify({ t: "data", ch, text }));
  }

  sendBinary(ch: number, bytes: Buffer): void {
    this.sendCounted(ch, encodeBinary({ t: "data", ch }, bytes));
  }

  /** One channel's frame, counted until the socket wrote it; a channel past its limit is closed, the tunnel kept. */
  private sendCounted(ch: number, frame: string | Buffer): void {
    const c = this.channels.get(ch);
    if (!c || this.ws.readyState !== WebSocket.OPEN) return;
    const n =
      typeof frame === "string" ? Buffer.byteLength(frame) : frame.length;
    if (c.unsent + n > this.channelLimit) {
      this.log(`${this.engineId} ch${ch}: ${c.unsent} bytes unsent, closed`);
      this.close(ch);
      c.channel.ended();
      return;
    }
    c.unsent += n;
    this.ws.send(frame, () => {
      c.unsent -= n;
    });
  }

  buffered(ch: number): number {
    return this.channels.get(ch)?.unsent ?? 0;
  }

  close(ch: number): void {
    if (this.channels.delete(ch)) this.tell({ t: "close", ch });
  }

  /** A new channel sharing `roots`: to the engine, or to the agent's own jobs; it emits `open` once answered. */
  open(
    roots: TunnelRoot[],
    kind: ChannelKind = "engine",
    synced = false,
  ): TunnelChannel {
    const ch = this.nextCh++;
    const channel = new TunnelChannel(ch, this);
    this.channels.set(ch, { channel, roots, unsent: 0 });
    this.tell({ t: "open", ch, roots, kind, ...(synced ? { synced } : {}) });
    return channel;
  }

  /** Hand a browser's WebRTC offer to the engine's supervisor, and resolve its answer. */
  signal(sdp: string, timeoutMs: number): Promise<string> {
    const req = this.nextReq++;
    return new Promise((ok, ko) => {
      const timer = setTimeout(() => {
        this.offers.delete(req);
        ko(new Error("the engine's machine did not answer the offer"));
      }, timeoutMs);
      this.offers.set(req, {
        ok: (s) => {
          clearTimeout(timer);
          ok(s);
        },
        ko: (e) => {
          clearTimeout(timer);
          ko(e);
        },
      });
      this.tell({ t: "rtc-offer", req, sdp });
    });
  }

  /** The socket went: every channel it carried ends, and every half-sent upload is dropped. */
  shutdown(): void {
    for (const o of this.offers.values()) o.ko(new Error("tunnel dropped"));
    this.offers.clear();
    for (const { channel } of this.channels.values()) channel.ended();
    this.channels.clear();
    for (const u of this.uploads.values()) {
      clearTimeout(u.idle);
      void u.chain.then((up) => up?.abort()).catch(() => {});
    }
    this.uploads.clear();
  }

  /** One text frame from the agent, checked for shape before anything reads it; a malformed one is ignored. */
  onText(text: string): void {
    const m = parseAgentMessage(text);
    if (!m) return;
    const carried = "ch" in m ? this.channels.get(m.ch) : undefined;
    switch (m.t) {
      case "opened":
        carried?.channel.opened();
        return;
      case "close":
        if (!carried) return;
        this.channels.delete(m.ch);
        if (m.reason) this.log(`${this.engineId} ch${m.ch}: ${m.reason}`);
        carried.channel.ended();
        return;
      case "data":
        carried?.channel.deliver(m.text, false);
        return;
      case "stat":
        void statPaths(carried?.roots ?? [], m.paths)
          .then((entries) =>
            this.tell({ t: "stat-reply", req: m.req, entries }),
          )
          .catch((e: Error) => {
            this.log(`${this.engineId} stat: ${e.message}`);
            this.tell({ t: "stat-reply", req: m.req, entries: [] });
          });
        return;
      case "get":
        void this.serveGet(m.req, carried?.roots ?? [], m.path);
        return;
      case "rtc-answer": {
        const o = this.offers.get(m.req);
        this.offers.delete(m.req);
        if (m.sdp) o?.ok(m.sdp);
        else o?.ko(new Error(m.error ?? "offer refused"));
        return;
      }
    }
  }

  private async serveGet(
    req: number,
    roots: TunnelRoot[],
    path: string,
  ): Promise<void> {
    try {
      await readFileChunks(roots, path, async (chunk, last) => {
        await drained(this.ws);
        if (this.ws.readyState === WebSocket.OPEN)
          this.ws.send(encodeBinary({ t: "chunk", req, last }, chunk));
      });
    } catch (e) {
      this.tell({ t: "get-error", req, error: (e as Error).message });
    }
  }

  /** One binary frame from the agent; a header of the wrong shape is ignored, as `decodeBinary` answers null for it. */
  onBinary(frame: Buffer): void {
    const decoded = decodeBinary(frame);
    if (!decoded) return;
    const { header, payload } = decoded;
    if (header.t === "data") {
      this.channels.get(header.ch)?.channel.deliver(payload, true);
      return;
    }
    if (header.t === "put") this.onPut(header, payload);
  }

  /** Chunks of one upload are chained on its request id, so they land in the order they came. */
  private onPut(
    header: Extract<BinaryHeader, { t: "put" }>,
    payload: Buffer,
  ): void {
    const { req } = header;
    if (this.refused.has(req)) {
      if (header.last) this.refused.delete(req);
      return;
    }
    let u = this.uploads.get(req);
    if (!u) {
      if (this.uploads.size >= this.limits.maxOpen) {
        this.refuse(req, header.last, "too many uploads open");
        return;
      }
      const roots = this.channels.get(header.ch)?.roots ?? [];
      const chain = Upload.start(roots, header.path).catch((e: Error) => {
        this.tell({ t: "put-reply", req, error: e.message });
        return null;
      });
      u = { chain, bytes: 0 };
      this.uploads.set(req, u);
    }
    u.bytes += payload.length;
    const why =
      u.bytes > this.limits.maxBytes
        ? `an upload is ${this.limits.maxBytes} bytes at most`
        : this.spend(payload.length);
    if (why) {
      this.fail(req, u, header.last, why);
      return;
    }
    clearTimeout(u.idle);
    const held = u;
    if (header.last) this.uploads.delete(req);
    else {
      held.idle = setTimeout(
        () => this.fail(req, held, false, "no chunk came in time"),
        this.limits.idleMs,
      );
      held.idle.unref?.();
    }
    held.chain = held.chain.then(async (up) => {
      if (!up) return null;
      try {
        await up.write(payload);
        if (!header.last) return up;
        this.tell({ t: "put-reply", req, stat: await up.finish() });
        return null;
      } catch (e) {
        clearTimeout(held.idle);
        if (this.uploads.get(req) === held) this.uploads.delete(req);
        this.remember(req, header.last);
        await up.abort();
        this.tell({ t: "put-reply", req, error: (e as Error).message });
        return null;
      }
    });
  }

  /** The hourly budget of this tunnel's uploads, spent; a reason when it is gone. */
  private spend(n: number): string | null {
    const now = Date.now();
    if (now - this.hour.start >= HOUR_MS) this.hour = { start: now, bytes: 0 };
    if (this.hour.bytes + n > this.limits.bytesPerHour)
      return `${this.limits.bytesPerHour} bytes uploaded this hour already`;
    this.hour.bytes += n;
    return null;
  }

  /** Give up an upload under way: its part file deleted, the agent told, its later chunks ignored. */
  private fail(req: number, u: Uploading, last: boolean, why: string): void {
    clearTimeout(u.idle);
    if (this.uploads.get(req) === u) this.uploads.delete(req);
    this.log(`${this.engineId} upload ${req}: ${why}`);
    u.chain = u.chain.then(async (up) => {
      await up?.abort();
      return null;
    });
    this.refuse(req, last, why);
  }

  private refuse(req: number, last: boolean, why: string): void {
    this.remember(req, last);
    this.tell({ t: "put-reply", req, error: why });
  }

  /** Remember a refused request id until its last chunk, the oldest forgotten first. */
  private remember(req: number, last: boolean): void {
    if (last) return;
    this.refused.add(req);
    if (this.refused.size > MAX_REFUSED)
      this.refused.delete(this.refused.values().next().value as number);
  }
}
