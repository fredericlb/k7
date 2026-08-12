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

/**
 * Read the song's picture.
 *
 * Asked of EVERY project, unconditionally, and that is what the service's empty answer is for:
 * a song with no `video_tracks/` gets a document with no lanes rather than a 400, so "this song
 * has no picture" and "this song's picture is broken" arrive as different answers. Gating the
 * call on something the shell already knew would just move the guess earlier.
 *
 * `doc` is null for the empty case, so the one thing every caller asks — is there picture here —
 * is a null check rather than a reach into `videoTracks.length` repeated at each site.
 *
 * An error is KEPT rather than swallowed, unlike `useSurfaces`': a surface that will not parse
 * has a visible symptom (the screen it names is missing), while a picture that will not compile
 * looks exactly like a song that never had one. The viewport pane says which it is.
 */
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
