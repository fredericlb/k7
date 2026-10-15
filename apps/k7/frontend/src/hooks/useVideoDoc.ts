// useVideoDoc.ts — the song's PICTURE, refetched on reloadKey and kept when it did not change. A second compile of the same
// folder (`GET /video-doc`), not a slice of the project doc: a song has a tempo and its picture
// has a viewport, and the engine must never be handed either of the latter's fields.
// See packages/song-video/docs/picture.md.

import type { WebVideoProject } from "@studio/web-protocol";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { isAnswer } from "../readFailure";

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
  // The last answer's text: an unchanged picture keeps its OBJECT, since a new one rebuilds the viewport's GL context, videos and lenses.
  const lastText = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .videoDoc()
      .then((d) => {
        if (!alive) return;
        const text = JSON.stringify(d);
        setState((cur) => {
          if (text === lastText.current && cur.error === null) return cur;
          lastText.current = text;
          return { doc: d.videoTracks.length ? d : null, error: null };
        });
      })
      .catch((e) => {
        // A blip keeps the picture on screen; only the compile's own refusal replaces it (../readFailure.ts).
        if (!alive || !isAnswer(e)) return;
        lastText.current = null;
        setState({ doc: null, error: (e as Error).message });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return state;
}
