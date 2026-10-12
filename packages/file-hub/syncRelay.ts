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
import type { Batch, Sequenced } from "@studio/live-sync/ops";
import { type FromRelay, parseToRelay } from "@studio/live-sync/protocol";
import { Room, type RoomState } from "@studio/live-sync/room";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import { SYNC_RELAY_PATH } from "@studio/web-protocol/pairing";
import { WebSocket, WebSocketServer } from "ws";
import {
  addCheckpoint,
  adoptLegacy,
  ENTRIES,
  readCheckpoints,
  rollLog,
} from "./historyLog.ts";

export const SYNC_PATH = SYNC_RELAY_PATH;

/** A saved state is rewritten after this many entries; the entries between live in an append-only log. */
const SNAPSHOT_EVERY = 200;
/** A full copy of the files is kept for history after this many entries, so a rebuild never replays from seq 1. */
const HISTORY_EVERY = 1000;
/** A room edited and then left alone this long gets an automatic checkpoint. */
const CHECKPOINT_IDLE_MS = 10 * 60_000;
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
  /** Told of every entry ordered, after it is on disk: what pushes a change notice to the account's browsers. */
  onOrdered?: (slug: string, workspace: string, entry: Sequenced) => void;
  /** The account whose rooms every authenticated replica may FOLLOW, read-only, as `@lib/<name>`: the libraries. */
  sharedAccount?: string;
  /** Tests only: the save and history-snapshot cadences, and the idle time before an automatic checkpoint. */
  snapshotEvery?: number;
  historyEvery?: number;
  checkpointIdleMs?: number;
}

/** One live room as the history routes reach it: `submit` orders a batch exactly as a replica's is. */
export interface LiveRoom {
  room: Room;
  dir: string;
  submit: (batch: Batch) => Sequenced;
}

/** The relay's stop, which saves every room, and its live rooms, loaded on demand. */
export type SyncRelay = (() => void) & {
  room: (slug: string, workspace: string) => LiveRoom;
};

interface Live {
  slug: string;
  room: Room;
  dir: string;
  /** Each socket in the room, by the name it joined with: `@lib/<name>` for a follower of a shared room. */
  sockets: Map<WebSocket, string>;
  sinceSnapshot: number;
  /** When the room was last edited, or null once that edit has its automatic checkpoint. */
  editedAt: number | null;
}

/** The prefix that names a room of the shared account (the libraries) rather than one of the caller's. */
export const SHARED_PREFIX = "@lib/";

/** A room's folder; the workspace name is a single folder name already (workspaceRoot refuses anything else). */
export const roomDir = (account: string, workspace: string): string =>
  join(account, ".sync-relay", encodeURIComponent(workspace));

function load(dir: string): Room {
  const file = join(dir, "room.json");
  const state = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as RoomState)
    : null;
  adoptLegacy(dir, state);
  const room = state ? Room.from(state) : new Room();
  const entries = join(dir, ENTRIES);
  if (existsSync(entries))
    for (const line of readFileSync(entries, "utf8").split("\n"))
      if (line) room.replay(JSON.parse(line) as Sequenced);
  return room;
}

function snapshot(live: Live, historyEvery: number): void {
  const tmp = join(live.dir, "room.json.tmp");
  const state = live.room.state();
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, join(live.dir, "room.json"));
  rollLog(live.dir, state.head, state.files, historyEvery);
  live.sinceSnapshot = 0;
}

const send = (ws: WebSocket, msg: FromRelay): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

/** The relay on the shared HTTP server, at SYNC_PATH; returns the stop, which saves every room. */
export function attachSyncRelay(server: Server, opts: RelayOptions): SyncRelay {
  const log = opts.log ?? ((m: string) => console.log(`sync | ${m}`));
  const snapshotEvery = opts.snapshotEvery ?? SNAPSHOT_EVERY;
  const historyEvery = opts.historyEvery ?? HISTORY_EVERY;
  const idleMs = opts.checkpointIdleMs ?? CHECKPOINT_IDLE_MS;
  const rooms = new Map<string, Live>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });

  const live = (slug: string, workspace: string): Live => {
    const key = `${slug}/${workspace}`;
    let l = rooms.get(key);
    if (!l) {
      const dir = roomDir(opts.accountDir(slug), workspace);
      mkdirSync(dir, { recursive: true });
      l = {
        slug,
        room: load(dir),
        dir,
        sockets: new Map(),
        sinceSnapshot: 0,
        editedAt: null,
      };
      rooms.set(key, l);
    }
    return l;
  };

  /** Order a batch: on disk first, then relayed to every replica in the room, the sender included. */
  const order = (l: Live, workspace: string, batch: Batch): Sequenced => {
    const { entry, fresh } = l.room.submit(batch);
    if (!fresh) return entry;
    appendFileSync(join(l.dir, ENTRIES), `${JSON.stringify(entry)}\n`);
    if (++l.sinceSnapshot >= snapshotEvery) snapshot(l, historyEvery);
    l.editedAt = Date.now();
    for (const [peer, as] of l.sockets)
      send(peer, { t: "seq", workspace: as, entry });
    opts.onOrdered?.(l.slug, workspace, entry);
    return entry;
  };

  // At most one automatic checkpoint per idle period: `editedAt` is cleared once it is taken.
  const idleCheck = setInterval(
    () => {
      const now = Date.now();
      for (const l of rooms.values()) {
        if (l.editedAt === null || now - l.editedAt < idleMs) continue;
        l.editedAt = null;
        if (readCheckpoints(l.dir).at(-1)?.seq === l.room.head) continue;
        addCheckpoint(l.dir, {
          seq: l.room.head,
          name: "auto",
          ts: now,
          by: "auto",
        });
      }
    },
    Math.max(10, Math.min(60_000, idleMs / 4)),
  );
  idleCheck.unref();

  const serve = (ws: WebSocket, slug: string): void => {
    const joined = new Set<string>();
    ws.on("message", (data) => {
      const msg = parseToRelay(data.toString());
      if (!msg) return send(ws, { t: "error", error: "not a sync message" });
      // `@lib/<name>` is the shared account's room, followed read-only by any replica; anything else is the caller's own.
      const shared =
        msg.workspace.startsWith(SHARED_PREFIX) && opts.sharedAccount;
      const l = shared
        ? live(
            opts.sharedAccount as string,
            msg.workspace.slice(SHARED_PREFIX.length),
          )
        : live(slug, msg.workspace);
      if (msg.t === "hello") {
        joined.add(msg.workspace);
        l.sockets.set(ws, msg.workspace);
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
      if (shared)
        return send(ws, {
          t: "error",
          workspace: msg.workspace,
          error: "a library is followed, never written, through the relay",
        });
      const head = l.room.head;
      const entry = order(l, msg.workspace, msg.batch);
      // A batch seen before is answered to its sender alone.
      if (entry.seq <= head)
        send(ws, { t: "seq", workspace: msg.workspace, entry });
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

  const stop = () => {
    clearInterval(beat);
    clearInterval(idleCheck);
    for (const l of rooms.values())
      if (l.sinceSnapshot) snapshot(l, historyEvery);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
  return Object.assign(stop, {
    room: (slug: string, workspace: string): LiveRoom => {
      const l = live(slug, workspace);
      return {
        room: l.room,
        dir: l.dir,
        submit: (batch: Batch) => order(l, workspace, batch),
      };
    },
  });
}
