// enginePlayback.ts — reaching a song on the ENGINE's machine: that machine's cache root,
// whether a file is in it, and the one-clip document that makes it audible. TWO DISKS is the
// whole difficulty: this browser talks to a hosted médiathèque, and the engine opens paths on
// its own disk, so nothing here is a URL. See ../../docs/playbackTarget.md.

import { clipDoc, emptyDoc, trackDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { ENGINE_TOKEN_HEADER, USER_HEADER } from "@studio/web-protocol";

/** The track a preview lives on — one name, so the engine's diff sees a track it already has. */
export const PREVIEW_TRACK = "song-preview";

/** The headers that machine's file service gates on, the engine's own token included. */
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

/** The médiathèque cache's absolute root on that machine, or null when it keeps none. */
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
    // Cross-origin refusal, or no file service there: either way there is nothing to open.
    return null;
  }
}

/** Whether that cache HOLDS a file — one byte, and any refusal reads as absent. */
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

/** A médiathèque-relative path as a file that machine can open — see ../../docs/playbackTarget.md. */
export function playablePath(root: string, path: string): string {
  // The separator is picked from the ROOT, which is native, while a médiathèque path is POSIX.
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return [root, ...path.split("/")].join(sep);
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
