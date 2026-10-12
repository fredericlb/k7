// syncRelay.ts — live sync's relay: one Room per account and workspace, ordering every replica's batches.
// A replica is one of this hub's file services, recognised by its secret, or a machine with a device token.
// Each entry is on disk BEFORE it is relayed, so a crash cannot leave a replica ahead of the room.
// See docs/syncRelay.md.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { join } from "node:path";
import type { Sequenced } from "@studio/live-sync/ops";
import { type FromRelay, parseToRelay } from "@studio/live-sync/protocol";
import { Room, type RoomState } from "@studio/live-sync/room";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import { WebSocket, WebSocketServer } from "ws";

export const SYNC_PATH = "/api/sync";

/** A saved state is rewritten after this many entries; the entries between live in an append-only log. */
const SNAPSHOT_EVERY = 200;
const HEARTBEAT_MS = 20_000;
const MAX_FRAME = 64 * 1024 * 1024;

/** Where one account's rooms are kept, and who a connecting file service is. */
export interface RelayOptions {
  /** The account folder a room is saved under: `<dataRoot>/<slug>`. */
  accountDir: (slug: string) => string;
  /** The account slug of the file service holding `secret`, or null when it is none of this hub's. */
  accountOf: (secret: string) => Promise<string | null>;
  /** The account slug a device token belongs to, or null when it is not one, or its device was removed. */
  deviceOf?: (token: string) => string | null;
  log?: (msg: string) => void;
}

interface Live {
  room: Room;
  dir: string;
  sockets: Set<WebSocket>;
  sinceSnapshot: number;
}

/** A room's folder; the workspace name is a single folder name already (workspaceRoot refuses anything else). */
const roomDir = (account: string, workspace: string): string =>
  join(account, ".sync-relay", encodeURIComponent(workspace));

function load(dir: string): Room {
  const state = join(dir, "room.json");
  const room = existsSync(state)
    ? Room.from(JSON.parse(readFileSync(state, "utf8")) as RoomState)
    : new Room();
  const entries = join(dir, "entries.jsonl");
  if (existsSync(entries))
    for (const line of readFileSync(entries, "utf8").split("\n"))
      if (line) room.replay(JSON.parse(line) as Sequenced);
  return room;
}

function snapshot(live: Live): void {
  const tmp = join(live.dir, "room.json.tmp");
  writeFileSync(tmp, JSON.stringify(live.room.state()));
  renameSync(tmp, join(live.dir, "room.json"));
  writeFileSync(join(live.dir, "entries.jsonl"), "");
  live.sinceSnapshot = 0;
}

const send = (ws: WebSocket, msg: FromRelay): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

/** The relay on the shared HTTP server, at SYNC_PATH; returns the stop, which saves every room. */
export function attachSyncRelay(
  server: Server,
  opts: RelayOptions,
): () => void {
  const log = opts.log ?? ((m: string) => console.log(`sync | ${m}`));
  const rooms = new Map<string, Live>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });

  const live = (slug: string, workspace: string): Live => {
    const key = `${slug}/${workspace}`;
    let l = rooms.get(key);
    if (!l) {
      const dir = roomDir(opts.accountDir(slug), workspace);
      mkdirSync(dir, { recursive: true });
      l = { room: load(dir), dir, sockets: new Set(), sinceSnapshot: 0 };
      rooms.set(key, l);
    }
    return l;
  };

  const serve = (ws: WebSocket, slug: string): void => {
    const joined = new Set<string>();
    ws.on("message", (data) => {
      const msg = parseToRelay(data.toString());
      if (!msg) return send(ws, { t: "error", error: "not a sync message" });
      const l = live(slug, msg.workspace);
      if (msg.t === "hello") {
        joined.add(msg.workspace);
        l.sockets.add(ws);
        const up = l.room.catchUp(msg.since);
        if (up.mode === "seed")
          send(ws, { t: "welcome", workspace: msg.workspace, mode: "seed" });
        else if (up.mode === "snapshot")
          send(ws, {
            t: "welcome",
            workspace: msg.workspace,
            mode: "snapshot",
            head: up.head,
            files: up.files,
            conflicts: up.conflicts,
          });
        else {
          send(ws, {
            t: "welcome",
            workspace: msg.workspace,
            mode: "entries",
            head: l.room.head,
            conflicts: up.conflicts,
          });
          for (const entry of up.entries)
            send(ws, { t: "seq", workspace: msg.workspace, entry });
        }
        return;
      }
      if (!joined.has(msg.workspace))
        return send(ws, {
          t: "error",
          workspace: msg.workspace,
          error: "hello first",
        });
      const { entry, fresh } = l.room.submit(msg.batch);
      if (!fresh)
        return send(ws, { t: "seq", workspace: msg.workspace, entry });
      appendFileSync(
        join(l.dir, "entries.jsonl"),
        `${JSON.stringify(entry)}\n`,
      );
      if (++l.sinceSnapshot >= SNAPSHOT_EVERY) snapshot(l);
      for (const peer of l.sockets)
        send(peer, { t: "seq", workspace: msg.workspace, entry });
    });
    ws.on("close", () => {
      for (const l of rooms.values()) l.sockets.delete(ws);
    });
  };

  const alive = new WeakMap<WebSocket, boolean>();
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  beat.unref();

  const handle = (
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): boolean => {
    if (new URL(req.url || "", "http://localhost").pathname !== SYNC_PATH)
      return false;
    const bearer = /^Bearer (.+)$/.exec(
      String(req.headers.authorization ?? ""),
    )?.[1];
    const secret = String(req.headers[HUB_SECRET_HEADER] ?? "");
    const account = bearer
      ? Promise.resolve(opts.deviceOf?.(bearer) ?? null)
      : opts.accountOf(secret);
    void account.then((slug) => {
      if (!slug) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        alive.set(ws, true);
        ws.on("pong", () => alive.set(ws, true));
        serve(ws, slug);
      });
    });
    return true;
  };

  // In front of the others, as the rehearsal room does: the registry closes an upgrade it does not know when alone.
  type Upgrade = (req: IncomingMessage, socket: Socket, head: Buffer) => void;
  const others = server.listeners("upgrade") as Upgrade[];
  server.removeAllListeners("upgrade");
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (handle(req, socket, head)) return;
    if (others.length === 0) socket.destroy();
    for (const l of others) l.call(server, req, socket, head);
  });
  log(`relay on ${SYNC_PATH}`);

  return () => {
    clearInterval(beat);
    for (const l of rooms.values()) if (l.sinceSnapshot) snapshot(l);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
}
