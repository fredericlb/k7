// cameraRtc.ts — signalling for ONE camera, from this machine's own window to a second device.
// A tablet reaching us over the LAN has no secure context, so it may not open a lens; but
// RTCPeerConnection is not secure-context gated, so it may still RECEIVE one. This relay carries
// the offer/answer/ICE between the two browsers and never a frame of video.
// The host end is loopback-only; a viewer presents the engine token, as the file service asks of
// the same device. See ../../docs/camera.md.

import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type { EngineRegistry } from "@studio/engine-registry";
import { WebSocket, WebSocketServer } from "ws";
import { line } from "../logbus.ts";
import { isLoopback } from "./origin.ts";

/** The one path this takes upgrades on; everything else on the server is somebody else's. */
const ROUTE = "/camera/rtc";

/** This machine's window, when it has one open — a second replaces the first, a window being unique. */
let host: WebSocket | null = null;
/** Viewers by the id the host addresses them with. */
const viewers = new Map<string, WebSocket>();

const send = (ws: WebSocket | null | undefined, msg: unknown): void => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

const deny = (socket: Socket, status: string): void => {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
};

/** What a viewer sends the host, and what the host sends back — read only far enough to route it. */
interface Signal {
  type?: string;
  to?: string;
  from?: string;
}

const parse = (data: unknown): Signal | null => {
  try {
    const m = JSON.parse(String(data)) as Signal;
    return m && typeof m === "object" ? m : null;
  } catch {
    return null;
  }
};

function onHost(ws: WebSocket): void {
  // A second window takes the slot: a stale socket holding it would leave every viewer unanswered.
  if (host && host !== ws) host.close(1000, "replaced");
  host = ws;
  line("camera", "a window is offering this machine's lenses");
  ws.on("message", (data) => {
    const m = parse(data);
    if (!m?.to) return;
    const { to, ...rest } = m;
    send(viewers.get(to), rest);
  });
  ws.on("close", () => {
    if (host === ws) host = null;
    // Every viewer is told, since a peer connection that simply stops reads as a frozen picture.
    for (const v of viewers.values())
      send(v, { type: "problem", text: "the machine's window closed" });
  });
}

function onViewer(ws: WebSocket): void {
  const id = randomBytes(9).toString("base64url");
  viewers.set(id, ws);
  ws.on("message", (data) => {
    const m = parse(data);
    if (!m?.type) return;
    if (!host)
      return send(ws, {
        type: "problem",
        text: "no window open on the machine to open a lens",
      });
    send(host, { ...m, from: id });
  });
  ws.on("close", () => {
    viewers.delete(id);
    send(host, { type: "gone", from: id });
  });
}

/** The status an upgrade is refused with, or null to take it. */
export type Refusal = "400 Bad Request" | "401 Unauthorized" | "403 Forbidden";

/**
 * Who may open this socket. Offering a lens is claiming to BE the machine, so the host end is
 * loopback and nothing else; a viewer from the LAN presents the engine token the file service
 * already asks that same device for. See ../../docs/camera.md.
 */
export function mayOpen(
  role: string | null,
  loopback: boolean,
  q: URLSearchParams,
  verify: (id: string, token: string) => boolean,
): Refusal | null {
  if (role !== "host" && role !== "viewer") return "400 Bad Request";
  if (role === "host") return loopback ? null : "403 Forbidden";
  if (loopback) return null;
  return verify(q.get("engine") || "", q.get("token") || "")
    ? null
    : "401 Unauthorized";
}

/** Take `/camera/rtc` upgrades on the app's own server, beside the engine relay's — see docs/camera.md. */
export function attachCameraRtc(server: Server, reg: EngineRegistry): void {
  const wss = new WebSocketServer({ noServer: true });

  /** An upgrade we do not serve is left to whoever else might; Node drops it only when nobody listens. */
  const notOurs = (socket: Socket): void => {
    if (server.listenerCount("upgrade") <= 1) socket.destroy();
  };

  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url || "", "http://localhost");
    } catch {
      return notOurs(socket);
    }
    if (url.pathname !== ROUTE) return notOurs(socket);

    const role = url.searchParams.get("role");
    const no = mayOpen(role, isLoopback(req), url.searchParams, (id, token) =>
      reg.verifyToken(id, token),
    );
    if (no) return deny(socket, no);

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (role === "host") onHost(ws);
      else onViewer(ws);
    });
  });
}

/** For the tests, which share a module with a live server otherwise. */
export function resetCameraRtc(): void {
  host = null;
  viewers.clear();
}
