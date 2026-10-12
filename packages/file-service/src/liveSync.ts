// liveSync.ts — turns live capture on for each open workspace, unless `STUDIO_LIVE_SYNC=0`.
// With `STUDIO_SYNC_URL` every batch also goes to the relay, which orders it for all replicas: the hub's own
// relay with the hub's secret, or a remote one with a device token (`STUDIO_SYNC_TOKEN`).
// See docs/liveCapture.md.

import { join } from "node:path";
import type { Conflict } from "@studio/live-sync/ops";
import { Replica } from "@studio/live-sync/replica";
import type { WorkspaceSyncStatus } from "@studio/web-protocol";
import { EXAMPLES_WORKSPACE } from "./demos.ts";
import { LiveCapture } from "./liveCapture.ts";
import { ConfirmedDir } from "./liveConfirmed.ts";
import { type Batch, LiveLog, liveLogFor, replicaId } from "./liveLog.ts";
import { authHeaders, type Linked, loadHead, RelayLink } from "./liveRelay.ts";
import { workspaceRoot } from "./slug.ts";
import { isBinary, skip, type Workspace } from "./workspace.ts";

const attached = new Map<
  string,
  { capture: LiveCapture; log: LiveLog; name: string; replica?: Replica }
>();
let relay: RelayLink | null = null;

export const liveSyncOn = (): boolean => process.env.STUDIO_LIVE_SYNC !== "0";

/** The relay link, made once, when this service was told where the relay is and how to prove its account. */
function relayLink(): RelayLink | null {
  const url = process.env.STUDIO_SYNC_URL;
  const token = process.env.STUDIO_SYNC_TOKEN;
  const secret = process.env.STUDIO_HUB_SECRET;
  if (!url || !(token || secret)) return null;
  relay ??= new RelayLink(
    url,
    token ? { token } : { secret: secret ?? "" },
    undefined,
    () =>
      void joinRooms(
        url,
        authHeaders(token ? { token } : { secret: secret ?? "" }),
      ),
  );
  return relay;
}

/** The relay's HTTP twin of its socket URL: `ws(s)://host/api/sync` → `http(s)://host/api/sync/rooms`. */
export const roomsUrl = (syncUrl: string): string =>
  `${syncUrl.replace(/^ws/, "http").replace(/\/+$/, "")}/rooms`;

/** The account's workspaces on the relay's side, as last listed, and when: a paired machine downloads them on demand. */
let remoteRooms: string[] = [];
let roomsAt = 0;

/** List the account's rooms; on the ORIGIN (no device token) every one is joined at once, since the server holds them all. */
async function joinRooms(
  syncUrl: string,
  headers: Record<string, string>,
): Promise<void> {
  try {
    const r = await fetch(roomsUrl(syncUrl), {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`rooms ${r.status}`);
    const { workspaces } = (await r.json()) as { workspaces: string[] };
    remoteRooms = workspaces.filter((w) => w !== EXAMPLES_WORKSPACE);
    roomsAt = Date.now();
    if (process.env.STUDIO_SYNC_TOKEN) return;
    // Imported late: workspaces.ts loads this module to attach what it opens.
    const { joinWorkspace } = await import("./workspaces.ts");
    for (const name of remoteRooms) joinWorkspace(name);
  } catch (e) {
    console.warn(
      `sync | could not list the account's workspaces: ${(e as Error).message}`,
    );
  }
}

/** Where each workspace lives, for a machine paired with a remote server: both, here only, or there only. */
export async function workspaceSyncStatus(
  local: string[],
): Promise<WorkspaceSyncStatus> {
  const url = process.env.STUDIO_SYNC_URL;
  if (!process.env.STUDIO_SYNC_TOKEN || !url || !liveSyncOn())
    return { paired: false, server: null, workspaces: [] };
  // A list older than half a minute is asked again, bounded: the page must not hang on a server that is away.
  if (Date.now() - roomsAt > 30_000)
    await joinRooms(url, authHeaders({ token: process.env.STUDIO_SYNC_TOKEN }));
  const here = new Set(local);
  const synced = (name: string): boolean =>
    (attached.get(workspaceRoot(name))?.replica?.head ?? 0) > 0;
  return {
    paired: true,
    server: new URL(url.replace(/^ws/, "http")).origin,
    workspaces: [
      ...local
        .filter((n) => n !== EXAMPLES_WORKSPACE)
        .map((name) => ({
          name,
          state: synced(name) ? ("synced" as const) : ("local" as const),
        })),
      ...remoteRooms
        .filter((n) => !here.has(n))
        .map((name) => ({ name, state: "server" as const })),
    ],
  };
}

/** Bring a workspace that exists only on the server down to this machine, and keep it synced from then on. */
export async function downloadWorkspace(name: string): Promise<boolean> {
  if (!remoteRooms.includes(name)) return false;
  const { joinWorkspace } = await import("./workspaces.ts");
  joinWorkspace(name);
  return true;
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

/** Start capturing `ws` (named `name` in its account) once; a no-op when live sync is off or it is already captured. */
export function attachLiveCapture(ws: Workspace, name: string): void {
  // Examples is each build's own, stocked on every replica: syncing it would make every build a conflict.
  if (!liveSyncOn() || attached.has(ws.root) || name === EXAMPLES_WORKSPACE)
    return;
  const logDir = liveLogFor(ws.root);
  const log = new LiveLog(logDir);
  const link = relayLink();
  const capture = new LiveCapture({
    root: ws.root,
    replica: replicaId(),
    skip,
    isBinary,
    onBatch: (b: Batch) => {
      log.append(b);
      link?.local(name, b);
    },
    blobDir: join(logDir, "blobs"),
    onMissingBlob: (blob) => link?.fetch(name, blob),
  });
  ws.liveCapture = capture;
  attached.set(ws.root, { capture, log, name });
  if (!link) {
    capture.start();
    return;
  }
  const written: string[] = [];
  const host = {
    read: (file: string) => capture.read(file),
    write: (file: string, text: string | null) => {
      written.push(file);
      capture.writeKnown(file, text);
    },
  };
  const confirmed = new ConfirmedDir(join(logDir, "confirmed"));
  const replica = new Replica(replicaId(), host, confirmed, loadHead(logDir));
  const linked: Linked = {
    name,
    capture,
    replica,
    written,
    onRemote: (files) => remoteLanded(ws, files),
  };
  link.add(linked, logDir);
  attached.set(ws.root, { capture, log, name, replica });
  // With a history, what moved while this service was down is diffed against the confirmed text and sent.
  capture.start(replica.head > 0 ? confirmed : undefined);
}

/** Stop capturing the workspace at `root`, which is gone or no longer served. */
export function detachLiveCapture(root: string): void {
  const a = attached.get(root);
  if (!a) return;
  a.capture.stop();
  relay?.remove(a.name);
  attached.delete(root);
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
  if (!a?.replica || !relay) return "unlinked";
  const batch = relay.resolve(a.name, id, take);
  if (!batch) return "unknown";
  a.log.append(batch);
  return "ok";
}
