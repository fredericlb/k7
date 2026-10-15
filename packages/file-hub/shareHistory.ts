// shareHistory.ts — what a file service needs of its workspace's history to make a share: a checkpoint named at
// the seq its own edits reached, and the files AT that checkpoint, a binary given as the path of its bytes here.
// The hub answers both because it is the history's one writer; a file service never opens `.sync-relay` itself.
// See packages/file-service/docs/share.md.

import { existsSync } from "node:fs";
import { parseBlobRef } from "@studio/live-sync/blob";
import type { CheckpointFiles } from "@studio/web-protocol";
import { blobFile, blobsDir } from "./blobStore.ts";
import {
  addCheckpoint,
  type Checkpoint,
  filesAt,
  headOnDisk,
} from "./historyLog.ts";
import { isWorkspaceName } from "./historyRoutes.ts";
import { type LiveRoom, roomDir } from "./syncRelay.ts";

/** A refusal the internal route answers as a 4xx, with a sentence the author reads. */
export class ShareHistoryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The room's folder, or a refusal naming why there is none. */
function room(accountDir: string, workspace: string): string {
  if (!isWorkspaceName(workspace))
    throw new ShareHistoryError(400, "not a workspace name");
  const dir = roomDir(accountDir, workspace);
  if (!existsSync(dir))
    throw new ShareHistoryError(
      404,
      `${workspace} has no history on this server — is it synced here?`,
    );
  return dir;
}

/** Name `seq` of the room: refused when the server has not ordered it yet, since the share would then lack edits. */
export function shareCheckpoint(
  accountDir: string,
  live: LiveRoom | null,
  workspace: string,
  seq: number,
  name: string,
  by: string,
): Checkpoint {
  const dir = room(accountDir, workspace);
  const head = live ? live.room.head : headOnDisk(dir);
  if (!Number.isInteger(seq) || seq < 0 || seq > head)
    throw new ShareHistoryError(
      409,
      `point ${seq} is not on the server yet (it is at ${head})`,
    );
  return addCheckpoint(dir, { seq, name, ts: Date.now(), by });
}

/** The files at `seq` under any of `prefixes`, each binary as the path of its bytes on this disk. */
export function shareFilesAt(
  accountDir: string,
  workspace: string,
  seq: number,
  prefixes: string[],
): CheckpointFiles {
  const dir = room(accountDir, workspace);
  const all = filesAt(dir, seq);
  const under = (f: string) =>
    prefixes.some(
      (p) => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`),
    );
  const out: CheckpointFiles = { seq, texts: {}, blobs: {} };
  const store = blobsDir(accountDir);
  for (const [file, text] of Object.entries(all)) {
    if (!under(file)) continue;
    const ref = parseBlobRef(text);
    if (!ref) {
      out.texts[file] = text;
      continue;
    }
    const at = blobFile(store, ref.hash);
    // A ref whose bytes never reached the server cannot be shared: said, rather than shipped as silence.
    if (!existsSync(at))
      throw new ShareHistoryError(
        409,
        `${file} has not finished uploading to the server — wait for sync, then share again`,
      );
    out.blobs[file] = { path: at, size: ref.size };
  }
  return out;
}
