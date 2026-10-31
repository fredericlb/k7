// consolidations.ts — on a local instance, what consolidating a moment on a server reads and writes here:
// the recording's audio it sends, and the list of servers the moment now lives on (../../docs/momentShare.md).
// What reads wrong: the list is this machine's memory of a send, never asked of the server again.

import type { Consolidation } from "@studio/rehearsal-shared";
import * as db from "../db.ts";
import { type CachedFile, captureOf } from "./captures.ts";
import { parseConsolidations, rowIn } from "./helpers.ts";

/** The moment's recording on disk, fetched into the cache; null when the moment or its recording is gone. */
export async function momentSource(
  ownerId: string,
  momentId: string,
): Promise<CachedFile | null> {
  const rec = rowIn("Comments", momentId, { OwnerId: ownerId });
  if (!rec?.fields.RecordingPath) return null;
  return captureOf(ownerId, rec.fields.RecordingPath)
    .file()
    .catch(() => null);
}

/** Remember that the moment now lives on `entry`'s server, replacing an older send through the same link. */
export function noteConsolidation(
  ownerId: string,
  momentId: string,
  entry: Consolidation,
): Consolidation[] | null {
  const rec = rowIn("Comments", momentId, { OwnerId: ownerId });
  if (!rec) return null;
  const list = [
    ...parseConsolidations(rec.fields.Consolidations).filter(
      (c) => c.link !== entry.link,
    ),
    entry,
  ];
  db.patchRecord("Comments", momentId, {
    Consolidations: JSON.stringify(list),
  });
  return list;
}
