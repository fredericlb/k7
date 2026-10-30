// markers.ts — pins on a recording's timeline, each with an optional comment: keyed by the recording's
// path and owned by an account, as moments are, so any capture can carry them (../../docs/moments.md).
// The one thing a reader would get wrong: a moment's own pins are Markers too, keyed by MomentId (moments.ts).

import { isCapturePath } from "@studio/mediatek/recordingName";
import type { Marker } from "@studio/rehearsal-shared";
import * as db from "../db.ts";
import type { FieldsOf } from "../schema.ts";
import { mapMarker, rowIn } from "./helpers.ts";

/** The owner's pins on a recording, in timeline order. */
export function listRecordingMarkers(
  ownerId: string,
  recordingPath: string,
): Marker[] {
  return db
    .listRecords("Markers", {
      RecordingPath: [recordingPath],
      OwnerId: [ownerId],
    })
    .map(mapMarker)
    .sort((a, b) => a.atSec - b.atSec);
}

/** A pin on the capture at `recordingPath`; null for a path that is no capture. */
export function addRecordingMarker(
  ownerId: string,
  recordingPath: string,
  { atSec, comment }: { atSec?: number; comment?: string },
): Marker | null {
  if (!isCapturePath(recordingPath)) return null;
  const marker = {
    atSec: Number(atSec) || 0,
    comment: String(comment ?? ""),
    createdAt: new Date().toISOString(),
  };
  const [{ id }] = db.addRecords("Markers", [
    {
      RecordingPath: recordingPath,
      OwnerId: ownerId,
      AtSec: marker.atSec,
      Comment: marker.comment,
      CreatedAt: marker.createdAt,
    },
  ]);
  return { id: String(id), ...marker };
}

// A recording's pin of this owner, never a moment's: those are edited through their moment.
function ownPin(ownerId: string, markerId: string) {
  const rec = rowIn("Markers", markerId, { OwnerId: ownerId });
  return rec?.fields.RecordingPath ? rec : null;
}

export function updateRecordingMarker(
  ownerId: string,
  markerId: string,
  patch: { atSec?: number; comment?: string },
): Marker | null {
  const rec = ownPin(ownerId, markerId);
  if (!rec) return null;
  const fields: Partial<FieldsOf<"Markers">> = {};
  if (patch.atSec !== undefined) fields.AtSec = Number(patch.atSec);
  if (patch.comment !== undefined) fields.Comment = String(patch.comment);
  db.patchRecord("Markers", rec.id, fields);
  return mapMarker({ id: rec.id, fields: { ...rec.fields, ...fields } });
}

export function deleteRecordingMarker(
  ownerId: string,
  markerId: string,
): boolean {
  const rec = ownPin(ownerId, markerId);
  if (!rec) return false;
  db.deleteRecords("Markers", [rec.id]);
  return true;
}
