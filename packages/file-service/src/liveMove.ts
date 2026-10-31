// liveMove.ts — move or copy a workspace from the link it syncs with to another of this account's — another server, or
// another account on the same one:
// the target's room is seeded with everything here, text and bytes. A move then empties the old room, which takes
// the workspace off that server's list and every device's synced with it; its history still holds it, and edits
// made meanwhile are held and go to the target. A copy stops after the seed and stays linked where it was.
// See docs/liveCapture.md.

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Replica } from "@studio/live-sync/replica";
import { ConfirmedDir } from "./liveConfirmed.ts";
import { replicaId } from "./liveLog.ts";
import type { RelayLink } from "./liveRelay.ts";
import {
  forgetRooms,
  linkFor,
  listRooms,
  originOf,
  recordFor,
  type SyncServer,
  serverOf,
  writeLinkRecord,
} from "./liveServers.ts";
import {
  type Attached,
  attachedAt,
  endBatch,
  linkUp,
  reportMoves,
} from "./liveSync.ts";

/** How long the target may take to confirm the whole workspace, its bytes included. */
const SEED_TIMEOUT_MS = 30 * 60_000;
/** …and the old server to confirm it emptied the room. */
const EMPTY_TIMEOUT_MS = 2 * 60_000;

const until = async (
  done: () => boolean,
  ms: number,
  what: string,
): Promise<void> => {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error(`timed out while ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

/** How a message names a link: its server, and its account when it has one. */
const named = (s: SyncServer): string =>
  s.as ? `${originOf(s.url)} (${s.as})` : originOf(s.url);

/** Why `a` cannot move or copy to `to` now, or null: it must be whole here, and the target must not hold its name. */
async function refusal(a: Attached, to: string): Promise<string | null> {
  if (!a.link || !a.replica || !a.server)
    return "this workspace syncs with no server";
  const target = serverOf(to);
  if (!target) return `this machine is not signed in to ${to}`;
  if (target.id === a.server.id)
    return `it already syncs with ${named(target)}`;
  if (a.link.textState(a.room) !== "current")
    return "it is still syncing — try again once it is up to date";
  if (Object.keys(a.capture.blobs?.pending() ?? {}).length)
    return "some of its files have not arrived here yet";
  if (a.replica.unconfirmed().length)
    return "edits made here have not reached its server yet";
  if ((await listRooms(target, 0)).includes(a.room))
    return `${named(target)} already has a workspace called '${a.room}'`;
  return null;
}

type Transfer = { to: string; link?: string; error?: string; copy?: boolean };

/** A move or copy under way, or the reason the last one failed, by workspace root: what the workspace list says. */
const moves = new Map<string, Transfer>();

export const moveState = (root: string): Transfer | undefined =>
  moves.get(root);
reportMoves(moveState);

/** Start sending the workspace at `root` to the link `to` names (an id or an origin); throws why it cannot, else runs on. */
async function startTransfer(
  root: string,
  to: string,
  copy: boolean,
): Promise<void> {
  const a = attachedAt(root);
  if (!a) throw new Error("this workspace is not synced");
  const running = moves.get(root);
  if (running && !running.error)
    throw new Error(`it is already ${running.copy ? "copying" : "moving"}`);
  const why = await refusal(a, to);
  if (why) throw new Error(why);
  const target = serverOf(to);
  const state: Transfer = {
    to: target ? originOf(target.url) : originOf(to),
    ...(target ? { link: target.id } : {}),
    ...(copy ? { copy } : {}),
  };
  moves.set(root, state);
  void (copy ? copyWorkspace(a, to) : moveWorkspace(a, to)).then(
    () => moves.delete(root),
    (e: Error) => moves.set(root, { ...state, error: e.message }),
  );
}

/** Move the workspace at `root` to `to`: there whole, then off the server it left. */
export const startMove = (root: string, to: string): Promise<void> =>
  startTransfer(root, to, false);

/** Copy the workspace at `root` to `to`: there whole, and still synced where it was. */
export const startCopy = (root: string, to: string): Promise<void> =>
  startTransfer(root, to, true);

/** Seed a fresh room named `a.room` on `target` with everything in `a`, its log in `seedDir`; the link still holds it. */
async function seed(
  a: Attached,
  target: SyncServer,
  seedDir: string,
): Promise<RelayLink> {
  rmSync(seedDir, { recursive: true, force: true });
  mkdirSync(seedDir, { recursive: true });
  const toLink = linkFor(target, () => {});
  // A fresh replica in an empty room: the relay answers "seed", and everything here becomes its first batch.
  const seeded = new Replica(
    replicaId(),
    {
      read: (f) => a.capture.read(f),
      write: () => {},
    },
    new ConfirmedDir(join(seedDir, "confirmed")),
    0,
  );
  toLink.add(
    {
      name: a.room,
      capture: a.capture,
      replica: seeded,
      written: [],
      onRemote: () => {},
    },
    seedDir,
  );
  try {
    await until(
      () => seeded.head > 0 && seeded.unconfirmed().length === 0,
      SEED_TIMEOUT_MS,
      `sending it to ${originOf(target.url)}`,
    );
  } catch (e) {
    toLink.remove(a.room);
    throw e;
  }
  return toLink;
}

/** Copy `a` to the server `to` names, the refusals already passed: the target's room is its own from then on. */
async function copyWorkspace(a: Attached, to: string): Promise<void> {
  const target = serverOf(to);
  if (!target) return;
  const seedDir = join(a.logDir, "copying");
  try {
    // Edits made meanwhile go on to the server it syncs with; the copy is what was here when it started.
    const toLink = await seed(a, target, seedDir);
    toLink.remove(a.room);
    forgetRooms(target);
  } finally {
    rmSync(seedDir, { recursive: true, force: true });
  }
}

/** Move `a` to the server `to` names, the refusals already passed. */
async function moveWorkspace(a: Attached, to: string): Promise<void> {
  const from = a.server;
  const fromLink = a.link;
  const fromReplica = a.replica;
  const target = serverOf(to);
  if (!from || !fromLink || !fromReplica || !target) return;
  a.held = [];
  const seedDir = join(a.logDir, "moving");
  try {
    // 1. The target is seeded with everything here, and holds it all.
    const toLink = await seed(a, target, seedDir);
    toLink.remove(a.room);

    // 2. The old room is emptied, and told it ends, so its other devices let it go.
    const removal = endBatch(a, `moved to ${originOf(target.url)}`);
    fromLink.local(a.room, removal);
    await until(
      () => fromReplica.unconfirmed().length === 0,
      EMPTY_TIMEOUT_MS,
      `removing it from ${originOf(from.url)}`,
    );
    fromLink.remove(a.room);

    // 3. Its history becomes the target's, and it is linked there from now on.
    for (const f of ["head", "confirmed"]) {
      rmSync(join(a.logDir, f), { recursive: true, force: true });
      if (existsSync(join(seedDir, f)))
        renameSync(join(seedDir, f), join(a.logDir, f));
    }
    writeLinkRecord(a.logDir, recordFor(target, a.room));
    linkUp(a, target);
    forgetRooms(from);
    forgetRooms(target);
    // A folder named `room.host` for the server it left takes its room's name back when that is free here.
    const { restoreRoomName } = await import("./workspaces.ts");
    await restoreRoomName(a.name);
  } finally {
    // Not moved on a throw: it stays linked where it was, and the target keeps whatever it got.
    rmSync(seedDir, { recursive: true, force: true });
    // What was edited meanwhile goes to wherever the workspace is linked now.
    const held = a.held ?? [];
    a.held = undefined;
    for (const b of held) a.link?.local(a.room, b);
  }
}
