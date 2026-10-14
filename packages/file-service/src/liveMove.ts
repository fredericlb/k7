// liveMove.ts — move a workspace from the server it syncs with to another this account is paired with: the
// target's room is seeded with everything here, text and bytes, and only once it holds all of it is the old
// room emptied, which takes the workspace off that server's list and every device's synced with it. The old
// room's history still holds it. Edits made meanwhile are held and go to the target. See docs/liveCapture.md.

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Replica } from "@studio/live-sync/replica";
import { ConfirmedDir } from "./liveConfirmed.ts";
import { replicaId } from "./liveLog.ts";
import {
  forgetRooms,
  hostOf,
  linkFor,
  listRooms,
  originOf,
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

/** Why `a` cannot move to `to` now, or null: it must be whole here, and the target must not hold its name. */
async function refusal(a: Attached, to: string): Promise<string | null> {
  if (!a.link || !a.replica || !a.server)
    return "this workspace syncs with no server";
  const target = serverOf(to);
  if (!target) return `this machine is not signed in to ${to}`;
  if (hostOf(target.url) === hostOf(a.server.url))
    return `it already syncs with ${originOf(to)}`;
  if (a.link.textState(a.room) !== "current")
    return "it is still syncing — try again once it is up to date";
  if (Object.keys(a.capture.blobs?.pending() ?? {}).length)
    return "some of its files have not arrived here yet";
  if (a.replica.unconfirmed().length)
    return "edits made here have not reached its server yet";
  if ((await listRooms(target, 0)).includes(a.room))
    return `${originOf(to)} already has a workspace called '${a.room}'`;
  return null;
}

/** A move under way, or the reason the last one failed, by workspace root: what the workspace list says. */
const moves = new Map<string, { to: string; error?: string }>();

export const moveState = (
  root: string,
): { to: string; error?: string } | undefined => moves.get(root);
reportMoves(moveState);

/** Start moving the workspace at `root` to the server `to` names; throws the reason it cannot, else runs on its own. */
export async function startMove(root: string, to: string): Promise<void> {
  const a = attachedAt(root);
  if (!a) throw new Error("this workspace is not synced");
  if (moves.get(root) && !moves.get(root)?.error)
    throw new Error("it is already moving");
  const why = await refusal(a, to);
  if (why) throw new Error(why);
  moves.set(root, { to: originOf(to) });
  void moveWorkspace(a, to).then(
    () => moves.delete(root),
    (e: Error) => moves.set(root, { to: originOf(to), error: e.message }),
  );
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
  rmSync(seedDir, { recursive: true, force: true });
  mkdirSync(seedDir, { recursive: true });
  const toLink = linkFor(target, () => {});
  try {
    // 1. A fresh replica in an empty room: the relay answers "seed", and everything here becomes its first batch.
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
    await until(
      () => seeded.head > 0 && seeded.unconfirmed().length === 0,
      SEED_TIMEOUT_MS,
      `sending it to ${originOf(target.url)}`,
    );
    toLink.remove(a.room);

    // 2. The target holds it all: the old room is emptied, and told it ends, so its other devices let it go.
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
    writeLinkRecord(a.logDir, { server: originOf(target.url), room: a.room });
    linkUp(a, target);
    forgetRooms(from);
    forgetRooms(target);
    // A folder named `room.host` for the server it left takes its room's name back when that is free here.
    const { restoreRoomName } = await import("./workspaces.ts");
    await restoreRoomName(a.name);
  } catch (e) {
    // Not moved: it stays linked where it was, and the target keeps whatever it got.
    toLink.remove(a.room);
    throw e;
  } finally {
    rmSync(seedDir, { recursive: true, force: true });
    // What was edited meanwhile goes to wherever the workspace is linked now.
    const held = a.held ?? [];
    a.held = undefined;
    for (const b of held) a.link?.local(a.room, b);
  }
}
