// liveSync.ts — turns live capture on for each open workspace, unless `STUDIO_LIVE_SYNC=0`, and links each to the
// relay of the server it belongs to (liveServers.ts): the hub's own relay with the hub's secret, or a paired
// server's with a device token. A workspace's batches go to whichever link it has NOW, which is what lets a
// move switch its server underneath it (liveMove.ts). See docs/liveCapture.md.

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileOpFor } from "@studio/live-sync/file-op";
import type { Conflict } from "@studio/live-sync/ops";
import { Replica } from "@studio/live-sync/replica";
import type {
  ProjectSyncState,
  WorkspaceSyncStatus,
} from "@studio/web-protocol";
import { EXAMPLES_WORKSPACE } from "./demos.ts";
import { LiveCapture } from "./liveCapture.ts";
import { ConfirmedDir } from "./liveConfirmed.ts";
import { type Batch, LiveLog, liveLogFor, replicaId } from "./liveLog.ts";
import {
  type Linked,
  loadHead,
  type RelayLink,
  type TextState,
} from "./liveRelay.ts";
import {
  ACCOUNT_LIBRARY_ROOM,
  hostOf,
  isPaired,
  linkFor,
  listRooms,
  localNameFor,
  mainServer,
  originOf,
  readLinkRecord,
  type SyncServer,
  serverOf,
  syncServers,
  writeLinkRecord,
} from "./liveServers.ts";
import { workspaceRoot } from "./slug.ts";
import { isBinary, skip, type Workspace } from "./workspace.ts";

export { ACCOUNT_LIBRARY_ROOM };

/** One captured workspace: where it syncs, by which link, and — while a move runs — the batches held back. */
export interface Attached {
  ws: Workspace;
  capture: LiveCapture;
  log: LiveLog;
  /** Its folder's name here. */
  name: string;
  logDir: string;
  /** Its name on its server, which differs from `name` when two servers hold the same one. */
  room: string;
  server?: SyncServer;
  link?: RelayLink;
  replica?: Replica;
  /** Set during a move: edits made meanwhile wait here and go to the server it lands on. */
  held?: Batch[];
}

const attached = new Map<string, Attached>();

export const liveSyncOn = (): boolean => process.env.STUDIO_LIVE_SYNC !== "0";

/** The captured workspace at `root`, for the move and the routes that look at its sync. */
export const attachedAt = (root: string): Attached | undefined =>
  attached.get(root);

/** How often a SERVER looks for a room a device created since it last joined them all. */
const ROOMS_EVERY_MS = 60_000;
let roomsTimer: ReturnType<typeof setInterval> | null = null;

/** On a SERVER: join every room holding files — one a device seeded or a move landed included, which no reconnect announces. */
export async function joinServerRooms(): Promise<void> {
  if (isPaired() || !liveSyncOn()) return;
  // Imported late: workspaces.ts loads this module to attach what it opens.
  const { joinWorkspace } = await import("./workspaces.ts");
  for (const server of syncServers())
    for (const name of await listRooms(server, 0)) joinWorkspace(name);
}

/** A link (re)connected: on a SERVER every room it lists is joined, since the server holds them all — and again every minute. */
function onOpen(_server: SyncServer): void {
  if (isPaired()) return;
  void joinServerRooms();
  roomsTimer ??= setInterval(() => void joinServerRooms(), ROOMS_EVERY_MS);
  roomsTimer.unref?.();
}

/** The move or copy a workspace is under, told by liveMove.ts — set there so this module does not import it back. */
let moving: (
  root: string,
) => { to: string; error?: string; copy?: boolean } | undefined = () =>
  undefined;
export const reportMoves = (f: typeof moving): void => {
  moving = f;
};

/** Where each workspace lives, for a machine paired with remote servers: synced, here only, or on a server only. */
export async function workspaceSyncStatus(
  local: string[],
): Promise<WorkspaceSyncStatus> {
  const servers = syncServers();
  if (!isPaired() || !servers.length || !liveSyncOn())
    return { paired: false, server: null, workspaces: [] };
  // Every server asked at once, each bounded: the page must not hang on one that is away.
  const lists = await Promise.all(servers.map((s) => listRooms(s)));
  const mine = local.filter((n) => n !== EXAMPLES_WORKSPACE);
  // What each local workspace is on its server: recorded, or the main one's under its own name.
  const here = mine.map((name) => {
    const a = attached.get(workspaceRoot(name));
    const rec = readLinkRecord(liveLogFor(workspaceRoot(name)));
    const server = a?.server?.url ?? rec?.server ?? servers[0].url;
    return {
      name,
      room: a?.room ?? rec?.room ?? name,
      server: originOf(server),
      host: hostOf(server),
      synced: (a?.replica?.head ?? 0) > 0,
    };
  });
  const held = new Set(here.map((h) => `${h.host}\n${h.room}`));
  return {
    paired: true,
    server: originOf(servers[0].url),
    servers: servers.map((s) => ({ origin: originOf(s.url), main: s.main })),
    workspaces: [
      ...here.map((h) => {
        const move = moving(workspaceRoot(h.name));
        return {
          name: h.name,
          state: h.synced ? ("synced" as const) : ("local" as const),
          server: h.server,
          ...(h.room !== h.name ? { room: h.room } : {}),
          ...(move ? { moving: move } : {}),
        };
      }),
      ...servers.flatMap((s, i) =>
        lists[i]
          .filter((room) => !held.has(`${hostOf(s.url)}\n${room}`))
          .map((room) => ({
            name: room,
            state: "server" as const,
            server: originOf(s.url),
          })),
      ),
    ],
  };
}

/** Bring workspace `room` of `server` (the main one when absent) down to this machine, and keep it synced from then on. */
export async function downloadWorkspace(
  room: string,
  server?: string,
  taken: (name: string) => boolean = () => false,
): Promise<string | null> {
  const s = server ? serverOf(server) : mainServer();
  if (!s || !(await listRooms(s)).includes(room)) return null;
  // Its folder here: the room's name, or `room.host` when another server's workspace already has it.
  const name = localNameFor(room, s, taken);
  writeLinkRecord(liveLogFor(workspaceRoot(name)), {
    server: originOf(s.url),
    room,
  });
  const { joinWorkspace } = await import("./workspaces.ts");
  joinWorkspace(name);
  return name;
}

/** An edit another replica made landed in `ws`: the caches go, and the engine hears of the open project. */
function remoteLanded(ws: Workspace, files: string[]): void {
  ws.invalidateProjectDoc();
  const active = ws.activeProjectPath();
  if (!active) return;
  const prefix = `${active.replace(/\\/g, "/")}/`;
  if (
    !files.some((f) => `${ws.root.replace(/\\/g, "/")}/${f}`.startsWith(prefix))
  )
    return;
  // Imported late: engineLink reaches back into the workspace registry this module is loaded by.
  void import("./engineLink.ts").then((m) => m.startEngineForActive(ws));
}

/** A replica of `a` over the history kept in `logDir`, writing through its capture. */
function replicaOf(a: Attached, logDir: string): Linked {
  const written: string[] = [];
  const host = {
    read: (file: string) => a.capture.read(file),
    write: (file: string, text: string | null) => {
      written.push(file);
      a.capture.writeKnown(file, text);
    },
  };
  const confirmed = new ConfirmedDir(join(logDir, "confirmed"));
  return {
    name: a.room,
    capture: a.capture,
    replica: new Replica(replicaId(), host, confirmed, loadHead(logDir)),
    written,
    onRemote: (files) => remoteLanded(a.ws, files),
    // Another replica deleted the workspace, or moved it elsewhere: this copy goes too.
    onEnded: () => void endedRemotely(a),
  };
}

/** Link `a` to `server` under its room, over the history in its log folder; answers the replica it got. */
export function linkUp(a: Attached, server: SyncServer): Replica {
  const link = linkFor(server, onOpen);
  const linked = replicaOf(a, a.logDir);
  a.server = server;
  a.link = link;
  a.replica = linked.replica;
  link.add(linked, a.logDir);
  return linked.replica;
}

/** Start capturing `ws` (named `name` in its account) once; a no-op when live sync is off or it is already captured. */
export function attachLiveCapture(ws: Workspace, name: string): void {
  // Examples is each build's own, stocked on every replica: syncing it would make every build a conflict.
  if (!liveSyncOn() || attached.has(ws.root) || name === EXAMPLES_WORKSPACE)
    return;
  const logDir = liveLogFor(ws.root);
  const log = new LiveLog(logDir);
  const rec = readLinkRecord(logDir);
  const root = ws.root;
  const capture = new LiveCapture({
    root,
    replica: replicaId(),
    skip,
    isBinary,
    onBatch: (b: Batch) => {
      log.append(b);
      const a = attached.get(root);
      if (a?.held) a.held.push(b);
      else a?.link?.local(a.room, b);
    },
    blobDir: join(logDir, "blobs"),
    onMissingBlob: (blob) => {
      const a = attached.get(root);
      a?.link?.fetch(a.room, blob);
    },
  });
  ws.liveCapture = capture;
  const a: Attached = {
    ws,
    capture,
    log,
    name,
    logDir,
    room: rec?.room ?? name,
  };
  attached.set(root, a);
  // Its recorded server, else the main one; a server no longer paired leaves it captured here, synced nowhere.
  const server = rec ? serverOf(rec.server) : mainServer();
  if (!server) {
    capture.start();
    return;
  }
  const replica = linkUp(a, server);
  // With a history, what moved while this service was down is diffed against the confirmed text and sent.
  capture.start(replica.head > 0 ? replica.confirmed : undefined);
}

/** One batch removing every file of `a` and saying the workspace ENDS: what a deletion and a move both send. */
export function endBatch(a: Attached, label: string): Batch {
  const ops = a.capture.textFiles().flatMap((file) => {
    const op = fileOpFor(file, a.capture.read(file), null);
    return op ? [op] : [];
  });
  return {
    id: randomUUID(),
    replica: a.replica?.id ?? replicaId(),
    local: 0,
    ts: Date.now(),
    label,
    ops,
    ends: true,
  };
}

/** Stop syncing `a` for good: its capture, its link and its history — a workspace of that name later starts afresh. */
function forget(a: Attached): void {
  a.capture.stop();
  a.link?.remove(a.room);
  attached.delete(a.ws.root);
  rmSync(a.logDir, { recursive: true, force: true });
}

/** How long a deletion waits for its server to confirm the room emptied, before letting go anyway. */
const END_CONFIRM_MS = 15_000;

/** The workspace at `root` is being DELETED here: its room is emptied and told it ends, then sync lets it go. */
export async function endWorkspace(root: string): Promise<void> {
  const a = attached.get(root);
  if (!a) return;
  if (a.link && a.replica) {
    a.link.local(a.room, endBatch(a, "workspace deleted"));
    // Bounded: a server out of reach keeps its copy, which then lists here as on the server only.
    const end = Date.now() + END_CONFIRM_MS;
    while (a.replica.unconfirmed().length && Date.now() < end)
      await new Promise((r) => setTimeout(r, 200));
  }
  forget(a);
}

/** Another replica ended the workspace: stop syncing it, and let the folder go unless it holds what never synced. */
async function endedRemotely(a: Attached): Promise<void> {
  forget(a);
  // Imported late: workspaces.ts loads this module to attach what it opens.
  const { dropEndedWorkspace } = await import("./workspaces.ts");
  await dropEndedWorkspace(a.name);
}

/** The room the workspace at `root` syncs as, when it is linked to one. */
export const roomAt = (root: string): string | undefined =>
  attached.get(root)?.room ?? readLinkRecord(liveLogFor(root))?.room;

/** Stop capturing the workspace at `root`, which is gone or no longer served. */
export function detachLiveCapture(root: string): void {
  const a = attached.get(root);
  if (!a) return;
  a.capture.stop();
  a.link?.remove(a.room);
  attached.delete(root);
}

/** Whether project `project` (a path in `ws`) is up to date with the relay, which is what `/open` waits for. */
export function projectSyncState(
  ws: Workspace,
  project: string,
): ProjectSyncState {
  const a = attached.get(ws.root);
  // Not linked to any relay: what is on disk is all there is, and nothing is on its way.
  if (!a?.replica || !a.link)
    return { state: "ready", ready: true, pending: 0 };
  // The capture keys files by their path in the workspace, slash-separated, whatever the platform.
  const dir = relative(ws.root, resolve(ws.root, project)).split(sep).join("/");
  const pending = pendingUnder(
    Object.keys(a.capture.blobs?.pending() ?? {}),
    dir,
  );
  return syncStateOf(a.link.textState(a.room), pending);
}

/** How many of the files waiting for bytes are under `dir`; the empty `dir` is the whole workspace. */
export const pendingUnder = (files: string[], dir: string): number =>
  files.filter((f) => !dir || f === dir || f.startsWith(`${dir}/`)).length;

/** The project's state from its text's and its missing files' — docs/liveCapture.md, "Up to date". */
export function syncStateOf(
  text: TextState,
  pending: number,
): ProjectSyncState {
  // Offline is opened with what is here, unless a file it names has no bytes yet: that would open broken.
  if (text === "offline")
    return { state: "offline", ready: pending === 0, pending };
  if (text !== "current") return { state: text, ready: false, pending };
  if (pending) return { state: "downloading", ready: false, pending };
  return { state: "ready", ready: true, pending: 0 };
}

/** The last `n` batches captured for `ws`, or null when live sync is not capturing it. */
export function liveLogTail(ws: Workspace, n: number): Batch[] | null {
  return attached.get(ws.root)?.log.tail(n) ?? null;
}

/** The open conflicts of `ws`, or null when it is not linked to a relay. */
export function liveConflicts(ws: Workspace): Conflict[] | null {
  return attached.get(ws.root)?.replica?.conflicts.list() ?? null;
}

/** Settle conflict `id` of `ws`: `take` writes its alternative over the value in place, and the room closes it either way. */
export function resolveConflict(
  ws: Workspace,
  id: string,
  take: boolean,
): "ok" | "unknown" | "unlinked" {
  const a = attached.get(ws.root);
  if (!a?.replica || !a.link) return "unlinked";
  const batch = a.link.resolve(a.room, id, take);
  if (!batch) return "unknown";
  a.log.append(batch);
  return "ok";
}
