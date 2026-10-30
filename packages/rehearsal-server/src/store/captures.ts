// captures.ts — the recording a moment was cut from, by its mediatek path: a session's take, or any
// other capture of the zone. Its bytes on disk, its envelope and its start, whichever it is.
// The one thing a reader would get wrong: a moment names a PATH, never a session (../../docs/moments.md).

import { createHash } from "node:crypto";
import path from "node:path";
import { capturedAt } from "@studio/mediatek/recordingName";
import type { Envelope } from "@studio/rehearsal-shared";
import { cachedFile, once } from "../cache.ts";
import * as db from "../db.ts";
import * as mediatek from "../mediatek.ts";
import { audioMimeOf } from "../serve.ts";
import { CACHE_DIR, fetching } from "./helpers.ts";
import { ensureRecordingCached, getEnvelope } from "./sessions.ts";

/** A recording on disk and the type it streams as. */
export interface CachedFile {
  filePath: string;
  mime: string;
}

export interface Capture {
  /** The owner's session that saved it, when one did. */
  sessionUid: string | null;
  startedAt: Date | null;
  file(): Promise<CachedFile | null>;
  envelope(): Promise<Envelope | null>;
}

const dateOf = (iso: string): Date | null => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? null : new Date(t);
};

/** The owner's sessions that hold a recording, by its path. */
export function sessionsByPath(
  ownerId: string,
): Map<string, { uid: string; createdAt: string }> {
  const recs = db.listRecords(
    "Sessions",
    { OwnerId: [ownerId] },
    { fields: ["Uid", "CreatedAt", "RecordingPath"] },
  );
  return new Map(
    recs
      .filter((r) => r.fields.RecordingPath)
      .map((r) => [
        r.fields.RecordingPath,
        { uid: r.fields.Uid, createdAt: r.fields.CreatedAt },
      ]),
  );
}

/** A capture by path: through its session when the owner saved it as one, so the session's cache and envelope serve. */
export function captureOf(ownerId: string, recordingPath: string): Capture {
  const [session] = db.listRecords(
    "Sessions",
    { RecordingPath: [recordingPath], OwnerId: [ownerId] },
    { fields: ["Uid", "CreatedAt"] },
  );
  if (session) {
    const uid = session.fields.Uid;
    return {
      sessionUid: uid,
      startedAt: dateOf(session.fields.CreatedAt),
      file: () => ensureRecordingCached(uid),
      envelope: () => getEnvelope(uid),
    };
  }
  return {
    sessionUid: null,
    startedAt: capturedAt(recordingPath),
    file: () => ensureCaptureCached(recordingPath),
    envelope: () => captureEnvelope(recordingPath),
  };
}

/** A capture no session holds, fetched byte-exact into the cache under a name its path makes. */
async function ensureCaptureCached(recordingPath: string): Promise<CachedFile> {
  const hash = createHash("sha1").update(recordingPath).digest("hex");
  const filePath = path.join(
    CACHE_DIR,
    `capture-${hash.slice(0, 16)}${path.extname(recordingPath)}`,
  );
  if (!cachedFile(filePath))
    await once(fetching, filePath, () =>
      mediatek.download(recordingPath, filePath),
    );
  return { filePath, mime: audioMimeOf(filePath) };
}

/** The library's own measurement, in the shape a session's envelope has; null when it cannot measure. */
async function captureEnvelope(
  recordingPath: string,
): Promise<Envelope | null> {
  try {
    const env = await mediatek.getFileEnvelope(recordingPath);
    if (!env.rms.length || !(env.seconds > 0)) return null;
    return {
      intervalMs: (env.seconds * 1000) / env.rms.length,
      samples: env.rms,
    };
  } catch {
    return null;
  }
}

/** Point every moment of an older row at its session's recording, once, at boot (../../docs/moments.md). */
export function linkMomentsToRecordings(): number {
  const legacy = db
    .listRecords("Comments", undefined, {
      fields: ["SessionUid", "SessionCreatedAt"],
    })
    .filter((r) => r.fields.SessionUid || r.fields.SessionCreatedAt);
  if (legacy.length === 0) return 0;
  const sessions = new Map(
    db
      .listRecords("Sessions", undefined, {
        fields: ["Uid", "CreatedAt", "RecordingPath"],
      })
      .map((s) => [s.fields.Uid, s.fields]),
  );
  db.inTransaction(() => {
    for (const r of legacy) {
      const s = sessions.get(r.fields.SessionUid);
      db.patchRecord("Comments", r.id, {
        RecordingPath: s?.RecordingPath ?? "",
        RecordedAt: s?.CreatedAt || r.fields.SessionCreatedAt || "",
        SessionUid: "",
        SessionCreatedAt: "",
      });
    }
  });
  return legacy.length;
}
