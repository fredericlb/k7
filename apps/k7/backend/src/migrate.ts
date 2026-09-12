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
    // The originating st0 song, so a re-export adds a version instead of a release.
    ["SongUuid", "Text"],
    ["CreatedAt", "Text"],
  ],
  Versions: [
    ["Uid", "Text"],
    ["ReleaseUid", "Text"],
    ["Name", "Text"],
    // AudioPath is the master of a song in the médiathèque — see ../../docs/audio.md.
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
    // SheetFiles holds the bytes; SheetMeta the parallel {id,name,mime}, in order.
    ["SheetFiles", "Attachments"],
    ["SheetMeta", "Text"],
    // The reference track, in the médiathèque like every other byte — ../../docs/audio.md.
    ["AudioPath", "Text"],
    ["AudioMime", "Text"],
    ["AudioName", "Text"],
    ["Favorite", "Bool"],
    ["CreatedAt", "Text"],
  ],
  SupernoteSync: [
    ["OwnerId", "Text"],
    ["Enabled", "Bool"],
    ["BaseUrl", "Text"],
    ["Account", "Text"],
    // The password, sealed — ../../docs/supernote.md. Never leaves the backend.
    ["Secret", "Text"],
    ["LastSyncAt", "Text"],
    ["LastStatus", "Text"],
    ["LastCount", "Numeric"],
    // song uid -> a hash of its text, so an unchanged song is not pushed every hour.
    ["Pushed", "Text"],
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

  // Backfill a moment's own OwnerId from its session's, which is what lets it outlive it.
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
