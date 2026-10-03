// hubTunnel.ts — ONE supervisor's tunnel as the hub sees it: the channels it carries and the
// file requests it makes. The hub (hub.ts) owns the set of these; this owns one socket.
// See docs/tunnel.md.

import { WebSocket } from "ws";
import { type ChannelSink, TunnelChannel } from "./channel.ts";
import { drained } from "./drain.ts";
import {
  type AgentMessage,
  asBuffer,
  type BinaryHeader,
  type ChannelKind,
  decodeBinary,
  encodeBinary,
  type HubMessage,
  type TunnelRoot,
} from "./frames.ts";
import { readFileChunks, statPaths, Upload } from "./hubFiles.ts";

interface Carried {
  channel: TunnelChannel;
  roots: TunnelRoot[];
}

export class HubTunnel implements ChannelSink {
  private readonly channels = new Map<number, Carried>();
  private readonly uploads = new Map<number, Promise<Upload | null>>();
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
  ) {
    ws.on("message", (data, isBinary) => {
      if (isBinary) this.onBinary(asBuffer(data as Buffer));
      else this.onText(asBuffer(data as Buffer).toString("utf8"));
    });
    ws.on("pong", () => {
      this.alive = true;
    });
  }

  private tell(m: HubMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  sendText(ch: number, text: string): void {
    this.tell({ t: "data", ch, text });
  }

  sendBinary(ch: number, bytes: Buffer): void {
    if (this.ws.readyState === WebSocket.OPEN)
      this.ws.send(encodeBinary({ t: "data", ch }, bytes));
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
    this.channels.set(ch, { channel, roots });
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
    for (const u of this.uploads.values())
      void u.then((up) => up?.abort()).catch(() => {});
    this.uploads.clear();
  }

  private onText(text: string): void {
    let m: AgentMessage;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
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
        void statPaths(carried?.roots ?? [], m.paths).then((entries) =>
          this.tell({ t: "stat-reply", req: m.req, entries }),
        );
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

  private onBinary(frame: Buffer): void {
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
    const roots = this.channels.get(header.ch)?.roots ?? [];
    const prev =
      this.uploads.get(header.req) ??
      Upload.start(roots, header.path).catch((e: Error) => {
        this.tell({ t: "put-reply", req: header.req, error: e.message });
        return null;
      });
    const next = prev.then(async (up) => {
      if (!up) return null;
      try {
        await up.write(payload);
        if (!header.last) return up;
        this.uploads.delete(header.req);
        this.tell({ t: "put-reply", req: header.req, stat: await up.finish() });
        return null;
      } catch (e) {
        this.uploads.delete(header.req);
        await up.abort();
        this.tell({
          t: "put-reply",
          req: header.req,
          error: (e as Error).message,
        });
        return null;
      }
    });
    if (header.last) {
      this.uploads.delete(header.req);
      void next;
    } else this.uploads.set(header.req, next);
  }
}
