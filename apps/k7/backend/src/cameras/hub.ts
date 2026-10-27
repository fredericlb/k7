// hub.ts — the account's remote cameras: a device in camera mode holds a socket here, a viewer asks
// for one by label, and the hub carries their WebRTC signalling between them. The picture itself
// never passes through this server: it goes peer to peer. A camera is visible to its own ACCOUNT
// only, and the hub keeps nothing on disk — a camera is listed for as long as its socket is open.
// See ../../docs/cameras.md.

import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  CAMERAS_WS_PATH,
  type CameraFrame,
  cleanCameraName,
  matchRemoteCamera,
  type RemoteCamera,
  readCameraFrame,
  uniqueCameraName,
} from "@studio/web-protocol/cameras";
import { type WebSocket, WebSocketServer } from "ws";
import type { Tickets } from "./ticket.ts";

/** Signalling frames are SDP and candidates: a few kilobytes, so anything far past it is not one. */
const MAX_FRAME_BYTES = 64 * 1024;
/** A socket that has not answered a ping in this long is dropped, and its camera unlisted. */
const PING_MS = 30_000;

interface Camera {
  id: string;
  account: string;
  name: string;
  since: number;
  ws: WebSocket;
}
interface Viewer {
  id: string;
  account: string;
  ws: WebSocket;
  /** The camera this viewer negotiates with, once its `want` was matched. */
  camera: Camera | null;
  /** Why it got that camera rather than the one it named, carried on the offer. */
  note: string | null;
}

export interface HubLimits {
  /** Cameras on at once, per account. */
  cameras?: number;
  /** Viewers at once, per account — each holds a peer connection on a camera. */
  viewers?: number;
}

export class CameraHub {
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
  });
  private readonly cameras = new Map<string, Camera>();
  private readonly viewers = new Map<string, Viewer>();
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private beat: NodeJS.Timeout | null = null;

  constructor(
    private readonly tickets: Tickets,
    private readonly limits: HubLimits = {},
  ) {}

  /** The account's cameras, newest last. */
  list(account: string): RemoteCamera[] {
    return [...this.cameras.values()]
      .filter((c) => c.account === account)
      .map((c) => ({ name: c.name, since: c.since }));
  }

  /** Take the camera socket's upgrades; every other path is left to the listeners beside this one. */
  attach(server: Server): () => void {
    const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      let url: URL;
      try {
        url = new URL(req.url ?? "", "http://localhost");
      } catch {
        return;
      }
      if (url.pathname !== CAMERAS_WS_PATH) return;
      const account = this.tickets.verify(url.searchParams.get("ticket") ?? "");
      if (!account) return deny(socket, "401 Unauthorized");
      const role = url.searchParams.get("role");
      if (role !== "camera" && role !== "viewer")
        return deny(socket, "400 Bad Request");
      const count = (m: Map<string, { account: string }>) =>
        [...m.values()].filter((x) => x.account === account).length;
      if (
        role === "camera" &&
        count(this.cameras) >= (this.limits.cameras ?? 8)
      )
        return deny(socket, "429 Too Many Requests");
      if (
        role === "viewer" &&
        count(this.viewers) >= (this.limits.viewers ?? 32)
      )
        return deny(socket, "429 Too Many Requests");
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.alive.set(ws, true);
        ws.on("pong", () => this.alive.set(ws, true));
        if (role === "camera")
          this.serveCamera(ws, account, url.searchParams.get("name") ?? "");
        else this.serveViewer(ws, account);
      });
    };
    server.on("upgrade", onUpgrade);
    this.beat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (!this.alive.get(ws)) {
          ws.terminate();
          continue;
        }
        this.alive.set(ws, false);
        ws.ping();
      }
    }, PING_MS);
    this.beat.unref();
    return () => {
      server.off("upgrade", onUpgrade);
      if (this.beat) clearInterval(this.beat);
      for (const ws of this.wss.clients)
        ws.close(1001, "the server is stopping");
    };
  }

  private serveCamera(ws: WebSocket, account: string, raw: string): void {
    const name = uniqueCameraName(
      cleanCameraName(raw),
      this.list(account).map((c) => c.name),
    );
    const cam: Camera = {
      id: randomBytes(8).toString("hex"),
      account,
      name,
      since: Date.now(),
      ws,
    };
    this.cameras.set(cam.id, cam);
    send(ws, { type: "hello", name });
    ws.on("message", (data) => {
      const f = readCameraFrame(data);
      if (!f || !("to" in f) || typeof f.to !== "string") return;
      const v = this.viewers.get(f.to);
      // Only a viewer that asked for THIS camera hears from it.
      if (!v || v.camera !== cam) return;
      const { to: _to, ...out } = f;
      if (out.type === "offer") out.problem = v.note;
      if (out.type === "offer" || out.type === "ice" || out.type === "problem")
        send(v.ws, out);
    });
    ws.on("close", () => {
      this.cameras.delete(cam.id);
      // A viewer's picture is peer to peer and dies with the camera; its socket is closed so it hears why.
      for (const v of this.viewers.values())
        if (v.camera === cam) v.ws.close(1001, "the camera went off");
    });
  }

  private serveViewer(ws: WebSocket, account: string): void {
    const v: Viewer = {
      id: randomBytes(8).toString("hex"),
      account,
      ws,
      camera: null,
      note: null,
    };
    this.viewers.set(v.id, v);
    ws.on("message", (data) => {
      const f = readCameraFrame(data);
      if (!f) return;
      if (f.type === "want" && typeof f.label === "string") {
        if (v.camera) return; // one camera per socket: a lane is one picture
        const found = matchRemoteCamera(f.label, this.list(account));
        const cam = [...this.cameras.values()].find(
          (c) => c.account === account && c.name === found.name,
        );
        if (!cam)
          return send(ws, {
            type: "problem",
            text: found.problem ?? "no remote camera is on",
          });
        v.camera = cam;
        v.note = found.problem ?? null;
        send(cam.ws, { type: "want", label: f.label, from: v.id });
        this.countViewers(cam);
        return;
      }
      if ((f.type === "answer" || f.type === "ice") && v.camera)
        send(v.camera.ws, { ...f, from: v.id } as CameraFrame);
    });
    ws.on("close", () => {
      this.viewers.delete(v.id);
      const cam = v.camera;
      if (!cam || !this.cameras.has(cam.id)) return;
      send(cam.ws, { type: "gone", from: v.id });
      this.countViewers(cam);
    });
  }

  /** Tell a camera how many are watching — what its screen shows. */
  private countViewers(cam: Camera): void {
    const count = [...this.viewers.values()].filter(
      (v) => v.camera === cam,
    ).length;
    send(cam.ws, { type: "viewers", count });
  }
}

function send(ws: WebSocket, f: CameraFrame): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(f));
}

function deny(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
