// player.ts — a share PLAYED: each visitor of a link gets a session of their own on the server's engine, opened
// by this backend through the tunnel and loaded with the share's compiled document. The visitor's socket reaches
// the engine only through the allowlist below — transport and per-track mute/solo — since the engine itself
// refuses nothing on a socket it trusts. See ../../../docs/media/sharePlayer.md.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import {
  OVERLOAD_CLOSE,
  sendBounded,
} from "@studio/engine-tunnel/backpressure";
import type { TunnelHub } from "@studio/engine-tunnel/hub";
import { acceptSocket, heartbeat } from "@studio/engine-tunnel/upgrade";
import { SHARE_ROOT } from "@studio/web-protocol";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { snapshotOf } from "../routes/publicShare.ts";
import { blobDir } from "./store.ts";

/** Where a visitor's socket opens: under the public share prefix, as the rest of a share is. */
export const PLAYER_ROUTE = /^\/api\/public\/share\/([0-9a-f]{64})\/play$/;

/** What the player needs of the backend: the tunnels, and the folders a share's document may name. */
export interface PlayerDeps {
  tunnels: TunnelHub;
  librariesHome: () => string;
  mediatekDir: () => string;
  /** Visitors playing at once across every share; the engine's 64 sessions are the studio's too. */
  maxVisitors?: number;
  /** …and from one address. */
  maxPerAddress?: number;
  log?: (msg: string) => void;
}

/** The visitor's address as `req.ip` reads it under `trust proxy` 1: the last hop the edge appended, else the socket. */
export function visitorAddress(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const list = (
    Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? "")
  )
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  return list.at(-1) ?? req.socket.remoteAddress ?? "?";
}

/** Transport actions a visitor may send, and nothing that records, auditions or reaches a plugin. */
const ACTIONS = new Set(["play", "stop", "toggle", "rewind", "panic"]);
/** Engine frames a visitor is shown: what drives the transport bar and the meters, never an error's server paths. */
const SHOWN = new Set(["state", "busy", "applied"]);
/** A visitor's messages per second beyond which the rest are dropped. */
const RATE = 30;
/** How long one visit may hold a session: a tab left open does not keep the engine's slot for ever. */
const MAX_VISIT_MS = 3 * 60 * 60 * 1000;

interface TrackDoc {
  id: string;
  mute?: boolean;
  solo?: boolean;
}

/** The share's engine document with its own files named under its folder here. */
function engineDocOf(key: string, engineDoc: string): { tracks: TrackDoc[] } {
  const dir = `${blobDir(key)}/`;
  const text = readFileSync(join(blobDir(key), engineDoc), "utf8");
  return JSON.parse(text, (_k, v) =>
    typeof v === "string" && v.startsWith(SHARE_ROOT)
      ? dir + v.slice(SHARE_ROOT.length)
      : v,
  );
}

export class SharePlayer {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly visits = new Set<WebSocket>();
  private readonly perAddress = new Map<string, number>();
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: PlayerDeps) {
    this.log = deps.log ?? ((m) => console.log(`share player | ${m}`));
  }

  /** Whether a share made now would play: the server's engine is configured and its tunnel is up. */
  check(): { available: boolean; why?: string } {
    if (!this.deps.tunnels.rendersEnabled())
      return {
        available: false,
        why: "this server has no engine of its own to play shares on",
      };
    if (!this.deps.tunnels.renderer())
      return {
        available: false,
        why: "the server's engine is not connected right now — try again in a moment",
      };
    return { available: true };
  }

  /** Take the visitors' upgrades; every other path is left to the handlers beside this one. */
  attach(server: Server): () => void {
    const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (req.url ?? "").split("?")[0];
      const m = PLAYER_ROUTE.exec(path);
      if (!m) return;
      acceptSocket(this.wss, req, socket, head, (ws) => {
        heartbeat(ws);
        this.visit(ws, m[1], visitorAddress(req));
      });
    };
    server.on("upgrade", onUpgrade);
    return () => {
      server.off("upgrade", onUpgrade);
      for (const ws of this.visits) ws.close(1001, "the server is stopping");
    };
  }

  private visit(ws: WebSocket, key: string, address: string) {
    const refuse = (why: string) => {
      ws.send(JSON.stringify({ type: "share-refused", message: why }));
      ws.close(1008, why.slice(0, 100));
    };
    const snap = snapshotOf(key);
    if (!snap) return refuse("no such share");
    const max = this.deps.maxVisitors ?? 8;
    if (this.visits.size >= max)
      return refuse("too many people are listening right now — try again soon");
    const mine = this.perAddress.get(address) ?? 0;
    if (mine >= (this.deps.maxPerAddress ?? 2))
      return refuse("this share is already open from here");
    const engine = this.deps.tunnels.renderer();
    if (!engine)
      return refuse("the server's engine is not connected right now");

    let doc: { tracks: TrackDoc[] };
    try {
      doc = engineDocOf(key, snap.engineDoc);
    } catch (e) {
      this.log(`cannot read ${key.slice(0, 8)}: ${(e as Error).message}`);
      return refuse("this share cannot be played");
    }
    const session = `share:${randomBytes(9).toString("base64url")}`;
    const channel = this.deps.tunnels.open(
      engine,
      [
        {
          remote: blobDir(key),
          name: `share-${key.slice(0, 16)}`,
          writable: false,
        },
        { remote: this.deps.librariesHome(), name: "libs", writable: false },
        { remote: this.deps.mediatekDir(), name: "mediatek", writable: false },
      ],
      "engine",
    );
    if (!channel)
      return refuse("the server's engine is not connected right now");

    this.visits.add(ws);
    this.perAddress.set(address, mine + 1);
    const toEngine = (o: Record<string, unknown>) =>
      channel.send(JSON.stringify({ ...o, session }));
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(expiry);
      toEngine({ type: "transport", action: "stop" });
      toEngine({ type: "drop-session" });
      channel.close();
      this.visits.delete(ws);
      const n = (this.perAddress.get(address) ?? 1) - 1;
      if (n > 0) this.perAddress.set(address, n);
      else this.perAddress.delete(address);
      if (ws.readyState === ws.OPEN) ws.close(1000);
    };
    const expiry = setTimeout(end, MAX_VISIT_MS);

    // The broadcast is the only way a visitor hears the server's engine: the page plays it (engineOutput.ts).
    ws.send(JSON.stringify({ type: "whoami", audioToBrowser: true }));
    channel.once("open", () => {
      toEngine({ type: "hello", role: "driver" });
      toEngine({ type: "project", doc });
      toEngine({ type: "broadcast", on: true });
    });
    // A visitor that stopped reading loses the broadcast frames first, then the visit (backpressure.ts).
    const toVisitor = (data: Buffer | string, isBinary: boolean) =>
      sendBounded(ws, data, isBinary, () => {
        ws.close(OVERLOAD_CLOSE, "too slow to follow the share");
        end();
      });
    channel.on("message", (data: Buffer, isBinary: boolean) => {
      if (ws.readyState !== ws.OPEN) return;
      if (isBinary) return toVisitor(data, true);
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(data.toString("utf8"));
      } catch {
        return;
      }
      if (!SHOWN.has(String(m.type))) return;
      // Sessionless to the page: its client keeps only frames for its own session or none.
      const { session: _s, ...frame } = m;
      toVisitor(JSON.stringify(frame), false);
    });
    channel.on("close", end);

    let windowStart = Date.now();
    let inWindow = 0;
    ws.on("message", (raw: RawData, isBinary: boolean) => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        inWindow = 0;
      }
      if (isBinary || ++inWindow > RATE) return;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const forward = allowed(m, doc);
      if (forward) toEngine(forward);
    });
    ws.on("close", end);
  }
}

/** What of a visitor's message reaches the engine, or null: the allowlist, and the one place it is written. */
export function allowed(
  m: Record<string, unknown>,
  doc: { tracks: TrackDoc[] },
): Record<string, unknown> | null {
  if (m.type === "transport") {
    const action = String(m.action);
    if (ACTIONS.has(action)) return { type: "transport", action };
    const n = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0;
    if (action === "seek" && n(m.position))
      return { type: "transport", action, position: m.position };
    if (action === "loop" && n(m.start) && n(m.end))
      return {
        type: "transport",
        action,
        start: m.start,
        end: m.end,
        enabled: m.enabled === true,
      };
    return null;
  }
  // A visitor's mute and solo, on THEIR session's copy of the document: whole tracks, as `tracks` replaces them.
  if (m.type === "track-mix" && Array.isArray(m.tracks)) {
    const changed: TrackDoc[] = [];
    for (const t of m.tracks as Record<string, unknown>[]) {
      const track = doc.tracks.find((x) => x.id === t?.id);
      if (!track) continue;
      track.mute = t.mute === true;
      track.solo = t.solo === true;
      changed.push(track);
    }
    return changed.length ? { type: "tracks", tracks: changed } : null;
  }
  return null;
}
