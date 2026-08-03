// Creates the Grist tables/columns this app needs, if they don't already exist.
// Safe to run repeatedly. Usage:  npm run migrate
//
// Schema:
//   Sessions   — one row per recording session (the audio lives in the
//                médiathèque, RecordingPath points at it; loudness envelope as
//                a JSON text column)
//   Highlights — auto-detected loud moments, one row per moment
//   Comments   — user annotations on a timespan, with tags

import {
  describeStep,
  migrateSchema,
  type TableSchema,
} from "@frediverse/db-grist";
import { grist, isConfigured, listRecords, patchRecord } from "./grist.ts";

const SCHEMA: TableSchema = {
  Sessions: [
    ["Uid", "Text"],
    ["OwnerId", "Text"],
    ["CreatedAt", "Text"],
    ["Duration", "Numeric"],
    ["HasRecording", "Bool"],
    ["RecordingMime", "Text"],
    // Where the bytes are, in the médiathèque's RECORDINGS zone. No audio lives in Grist.
    ["RecordingPath", "Text"],
    ["Envelope", "Text"],
    ["Gain", "Numeric"],
  ],
  Highlights: [
    ["SessionUid", "Text"],
    ["StartSec", "Numeric"],
    ["EndSec", "Numeric"],
    ["DurationSec", "Numeric"],
    ["Avg", "Numeric"],
    ["Peak", "Numeric"],
  ],
  Comments: [
    ["SessionUid", "Text"],
    ["OwnerId", "Text"],
    ["StartSec", "Numeric"],
    ["EndSec", "Numeric"],
    ["Text", "Text"],
    ["Tags", "Text"],
    ["CreatedAt", "Text"],
    ["Validated", "Bool"],
    // The extract, in the médiathèque's capture zone: moment-<HH-MM-SS>--<durée>--<nom>.
    ["ClipPath", "Text"],
    ["Envelope", "Text"],
  ],
  Markers: [
    ["SessionUid", "Text"],
    ["MomentId", "Text"],
    ["OwnerId", "Text"],
    ["AtSec", "Numeric"],
    ["Comment", "Text"],
    ["CreatedAt", "Text"],
  ],
  Releases: [
    ["Uid", "Text"],
    ["OwnerId", "Text"],
    ["Title", "Text"],
    ["Artist", "Text"],
    ["ReleaseDate", "Text"],
    ["Description", "Text"],
    ["CanDownload", "Bool"],
    // Stable id of the originating pistes song (set on CLI import); lets a
    // re-export add a version to the same release instead of creating a new one.
    ["SongUuid", "Text"],
    ["CreatedAt", "Text"],
  ],
  Versions: [
    ["Uid", "Text"],
    ["ReleaseUid", "Text"],
    ["Name", "Text"],
    // A published version IS a morceau in the médiathèque, under
    // morceaux/recorded/K7/<release>/<version>/. AudioPath points at its master; the
    // stems sit in `stems/` beside it and TrackMeta is the parallel JSON of
    // {id,path,name,mime}, preserving order + original name + type. See docs/audio.md.
    ["AudioPath", "Text"],
    ["AudioMime", "Text"],
    ["TrackMeta", "Text"],
    ["IsDefault", "Bool"],
    ["CreatedAt", "Text"],
  ],
  Pages: [
    ["Uid", "Text"],
    ["OwnerId", "Text"],
    ["Nametag", "Text"],
    ["ReleaseUids", "Text"],
    ["CreatedAt", "Text"],
  ],
  Songs: [
    ["Uid", "Text"],
    ["OwnerId", "Text"],
    ["Artist", "Text"],
    ["Title", "Text"],
    ["Lyrics", "Text"],
    ["Tablature", "Text"],
    // A sheet is not text — it is a PDF or a set of images. SheetFiles holds the
    // uploaded attachments (source of truth for the bytes, visible in the Grist
    // UI); SheetMeta is a parallel JSON array of {id,name,mime} preserving each
    // file's original name, type and order.
    ["SheetFiles", "Attachments"],
    ["SheetMeta", "Text"],
    ["Favorite", "Bool"],
    ["CreatedAt", "Text"],
  ],
};

async function migrate(): Promise<void> {
  if (!isConfigured()) {
    console.error(
      "✗ Grist is not configured. Set GRIST_API_URL, GRIST_DOC_ID and GRIST_API_KEY (see .env.example).",
    );
    process.exit(1);
  }

  for (const step of await migrateSchema(grist, SCHEMA)) {
    console.log(describeStep(step));
  }

  // Moments (Comments) are now standalone entities keyed by their own OwnerId so
  // they can survive their session's deletion. Backfill OwnerId on any existing
  // moment from its session's owner (idempotent — only fills blanks).
  const sessions = await listRecords("Sessions");
  const ownerByUid = new Map(
    sessions.map((s) => [s.fields.Uid, s.fields.OwnerId]),
  );
  const comments = await listRecords("Comments");
  const missing = comments.filter(
    (c) => !c.fields.OwnerId && ownerByUid.has(c.fields.SessionUid),
  );
  for (const c of missing) {
    await patchRecord("Comments", c.id, {
      OwnerId: ownerByUid.get(c.fields.SessionUid) as string,
    });
  }
  if (missing.length) {
    console.log(
      `✓ Comments: backfilled OwnerId on ${missing.length} moment(s)`,
    );
  }

  console.log("Migration complete.");
}

migrate().catch((err: unknown) => {
  console.error("Migration failed:", (err as Error).message);
  process.exit(1);
});
