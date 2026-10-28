// singing.ts — the singing exercises: one practice book everyone reads, each entry deletable by
// the one who wrote it (../../docs/ownership.md).

import { randomUUID } from "node:crypto";
import type { SingingExercise } from "@studio/rehearsal-shared";
import type { Row } from "../db.ts";
import * as db from "../db.ts";
import type { FieldsOf } from "../schema.ts";

type SingingRow = Row<"SingingExercises">;

function publicSinging(rec: SingingRow, viewer = ""): SingingExercise {
  const f = rec.fields;
  return {
    id: f.Uid,
    ownerId: f.OwnerId,
    title: f.Title || "",
    description: f.Description || "",
    videoUrl: f.VideoUrl || "",
    // The asking user wrote it, which is what lets them delete it — ../../docs/ownership.md.
    mine: Boolean(viewer) && f.OwnerId === viewer,
    createdAt: f.CreatedAt || "",
  };
}

async function getSingingRecord(uid: string): Promise<SingingRow | null> {
  const recs = await db.listRecords("SingingExercises", { Uid: [uid] });
  return recs[0] || null;
}

export async function getSingingExerciseOwner(
  uid: string,
): Promise<string | null> {
  const rec = await getSingingRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

export async function listSingingExercises(viewer = "") {
  // Everyone's, not the viewer's: the practice book is common ground, like the library.
  const recs = await db.listRecords("SingingExercises");
  return recs
    .map((rec) => publicSinging(rec, viewer))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** What an exercise is written with, and what an edit may change. */
interface SingingFields {
  title: string;
  description?: string;
  videoUrl?: string;
}

export async function createSingingExercise(
  ownerId: string,
  { title, description, videoUrl }: SingingFields,
) {
  const uid = randomUUID();
  await db.addRecords("SingingExercises", [
    {
      Uid: uid,
      OwnerId: ownerId,
      Title: title,
      Description: description || "",
      VideoUrl: videoUrl || "",
      CreatedAt: new Date().toISOString(),
    },
  ]);
  const rec = await getSingingRecord(uid);
  return rec ? publicSinging(rec) : null;
}

export async function updateSingingExercise(
  uid: string,
  patch: Partial<SingingFields>,
  viewer = "",
) {
  const rec = await getSingingRecord(uid);
  if (!rec) return null;
  // Typed, or an empty literal infers `{}` and refuses every key put in it.
  const fields: Partial<FieldsOf<"SingingExercises">> = {};
  if (patch.title !== undefined) fields.Title = patch.title;
  if (patch.description !== undefined) fields.Description = patch.description;
  if (patch.videoUrl !== undefined) fields.VideoUrl = patch.videoUrl;
  if (Object.keys(fields).length)
    await db.patchRecord("SingingExercises", rec.id, fields);
  const after = await getSingingRecord(uid);
  return after ? publicSinging(after, viewer) : null;
}

export async function deleteSingingExercise(uid: string): Promise<boolean> {
  const rec = await getSingingRecord(uid);
  if (!rec) return false;
  await db.deleteRecords("SingingExercises", [rec.id]);
  return true;
}
