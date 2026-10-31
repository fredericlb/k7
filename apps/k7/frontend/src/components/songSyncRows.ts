// songSyncRows.ts — the backend's jobs over the songs that follow the server, as download-manager rows: the update
// check, then each song it brings down again. A finished job is handed over once only, so a row the manager already
// let go of after its linger is not drawn again by the next poll. See ../../../backend/docs/media/songUpdates.md.

import type { Download } from "@studio/http-client/downloads";
import type { SongSyncJob } from "@studio/mediatek/types";

/** What the rows say, the host's sentences. */
export interface SongSyncWords {
  checking: string;
  upToDate: string;
  updated: (count: number) => string;
  gone: (count: number) => string;
}

/** Every row key starts with it, so the mirror owns these rows and nothing else. */
export const SONG_SYNC_PREFIX = "songs-sync:";

/** The check's row label: what it is doing, then what it found. */
function checkLabel(j: SongSyncJob, w: SongSyncWords): string {
  if (j.phase === "running") return w.checking;
  const said = [
    j.updated ? w.updated(j.updated) : "",
    j.gone ? w.gone(j.gone) : "",
  ].filter(Boolean);
  return said.length ? said.join(" · ") : w.upToDate;
}

/** The rows for `jobs`; `handed` holds the finished keys already handed over, and is added to. */
export function songSyncRows(
  jobs: readonly SongSyncJob[],
  words: SongSyncWords,
  handed: Set<string>,
): Download[] {
  const rows: Download[] = [];
  for (const j of jobs) {
    const key = `${SONG_SYNC_PREFIX}${j.key}`;
    if (j.phase !== "running") {
      if (handed.has(key)) continue;
      handed.add(key);
    }
    rows.push({
      key,
      kind: "song",
      label:
        j.kind === "check"
          ? checkLabel(j, words)
          : (j.path ?? "").split("/").slice(1).join(" / "),
      phase: j.phase,
      error: j.error,
    });
  }
  return rows;
}
