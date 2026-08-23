// useVideoDoc.ts — the song's PICTURE, refetched on reloadKey. A second compile of the same
// folder (`GET /video-doc`), not a slice of the project doc: a song has a tempo and its picture
// has a viewport, and the engine must never be handed either of the latter's fields.
// See packages/song/docs/picture.md.

import type { WebVideoProject } from "@studio/web-protocol";
import { useEffect, useState } from "react";
import { api } from "../api";

export interface VideoDocState {
  /** The compiled picture, or null when this song carries none. */
  doc: WebVideoProject | null;
  /** The compile's own message when the picture will not build — null while it does. */
  error: string | null;
}

const NONE: VideoDocState = { doc: null, error: null };

/** Read the song's picture, asked of EVERY project: `doc` is null for the empty case, and an error is KEPT, a broken picture looking like none. */
export function useVideoDoc(reloadKey: number): VideoDocState {
  const [state, setState] = useState<VideoDocState>(NONE);

  useEffect(() => {
    let alive = true;
    api
      .videoDoc()
      .then((d) => {
        if (!alive) return;
        setState({ doc: d.videoTracks.length ? d : null, error: null });
      })
      .catch((e) => {
        if (alive) setState({ doc: null, error: (e as Error).message });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return state;
}
