// enginePlayback.ts — reaching a song on the ENGINE's machine: where it is on that machine's disk,
// and the one-clip document that makes it audible. TWO DISKS is the whole difficulty: this browser
// talks to a hosted médiathèque, and the engine opens paths on its own disk, so this service brings
// the song there first and answers with the path. See ../../docs/playbackTarget.md.

import { clipDoc, emptyDoc, trackDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { BASE } from "../api";

/** The track a preview lives on — one name, so the engine's diff sees a track it already has. */
export const PREVIEW_TRACK = "song-preview";

/** Where a song is on that engine's machine, fetched there first; `why` says which of three things went wrong. */
export async function localPathOn(
  engineId: string,
  path: string,
): Promise<
  { path: string } | { why: "absent" | "missing" | "failed"; error: string }
> {
  try {
    const res = await fetch(`${BASE}/api/engine-local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engineId, path }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      path?: string;
      error?: string;
    };
    if (res.ok && body.path) return { path: body.path };
    const why =
      res.status === 404
        ? "missing"
        : res.status === 503 || res.status === 409
          ? "absent"
          : "failed";
    return { why, error: body.error ?? `the server answered ${res.status}` };
  } catch (e) {
    return { why: "failed", error: (e as Error).message };
  }
}

/** The document: one clip, no plugins — a master IS the audio, so the chain is empty. */
export function songPreviewDoc(absolutePath: string, name: string): ProjectDoc {
  return emptyDoc({
    name: `preview: ${name}`,
    tracks: [
      trackDoc(PREVIEW_TRACK, {
        name,
        clips: [
          clipDoc({
            id: `${PREVIEW_TRACK}-clip`,
            type: "audio",
            name,
            source: absolutePath,
          }),
        ],
      }),
    ],
  });
}
