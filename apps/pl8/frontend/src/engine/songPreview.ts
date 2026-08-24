// songPreview.ts — the smallest document that makes a CACHED SONG audible on a machine's
// engine: its file as the one clip on the one track, and nothing else. The degenerate case is
// the only case here, which is why there is one document builder and not two.
// See ../../docs/playback.md.

import { clipDoc, emptyDoc, trackDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import type { MediatekEntry } from "@studio/mediatek/types";
import { ENGINE_TOKEN_HEADER, USER_HEADER } from "@studio/web-protocol";

/** The track a preview lives on — one name, so the engine's diff sees a track it already has. */
export const PREVIEW_TRACK = "song-preview";

/** The headers the engine's file service gates on, the token included (../../docs/playback.md). */
function engineHeaders(
  user: string,
  token?: string | null,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    ...extra,
    [USER_HEADER]: user,
    ...(token ? { [ENGINE_TOKEN_HEADER]: token } : {}),
  };
}

/** The cache's absolute root on the engine's machine — two disks, and one trap (../../docs/playback.md). */
export async function cacheRoot(
  fileBase: string,
  user: string,
  token?: string | null,
): Promise<string | null> {
  try {
    const res = await fetch(`${fileBase}/mediatek`, {
      headers: engineHeaders(user, token),
    });
    if (!res.ok) return null;
    const { present, root } = (await res.json()) as {
      present?: boolean;
      root?: string;
    };
    return present && root ? root : null;
  } catch {
    // Cross-origin refusal, or no file service there: either way the button stays disabled.
    return null;
  }
}

/** Whether that machine's cache HOLDS a file — one byte, and any refusal reads as absent (../../docs/playback.md). */
export async function cachedOnMachine(
  fileBase: string,
  user: string,
  path: string,
  token?: string | null,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${fileBase}/mediatek/file?path=${encodeURIComponent(path)}`,
      { headers: engineHeaders(user, token, { range: "bytes=0-0" }) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** A catalogue entry as a file the engine can open, or null for a REAL state (../../docs/playback.md). */
export function playablePath(
  root: string,
  entry: MediatekEntry,
  file?: string | null,
): string | null {
  const master = file ?? entry.meta?.master;
  if (typeof master !== "string" || !master) return null;
  // Joined with a separator picked from the ROOT, which is native while entry paths are POSIX.
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return [root, entry.path, master].join(sep);
}

/** What a bounce came back as; `mp3` is false when the machine had no ffmpeg (../../docs/playback.md). */
export interface Bounced {
  bytes: Blob;
  mp3: boolean;
}

/** Bounce a document to audio on the engine's machine, OFFLINE — see ../../docs/playback.md. */
export async function bounce(
  fileBase: string,
  user: string,
  doc: ProjectDoc,
  token?: string | null,
): Promise<Bounced> {
  const res = await fetch(`${fileBase}/render`, {
    method: "POST",
    headers: engineHeaders(user, token, {
      "content-type": "application/json",
    }),
    body: JSON.stringify({ doc, format: "mp3" }),
  });
  if (!res.ok) {
    // The route answers `{error}` with a diagnosis; dropping it leaves "render failed" and nothing else.
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `render ${res.status}`);
  }
  const bytes = await res.blob();
  return {
    bytes,
    mp3: (res.headers.get("content-type") ?? "").includes("mpeg"),
  };
}

/** The document: no plugins, and an empty `recordDir` since a preview never records (../../docs/playback.md). */
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
