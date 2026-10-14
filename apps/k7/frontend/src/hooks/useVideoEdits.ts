// useVideoEdits.ts — commit a finished picture drag to the lane's own file. Shared by the shell's
// timeline pane and by a timeline surface alone on a second device, which drag the same clips.
// See ../../docs/picture.md.

import {
  listVideoPlacements,
  setVideoPlacementFieldAt,
  shiftVideoAnimationAt,
} from "@studio/song-schema/yaml/videoTrackFile";
import { useCallback } from "react";
import { api } from "../api";
import type { VideoEdit } from "../components/TimelineTab";
import type { SetStatus } from "./useLogs";

/** Apply a finished picture drag to the lane's own file: a SURGICAL text rewrite by INDEX, one buffer written once, and not a COMMAND. */
export function useVideoEdits(
  project: string,
  bumpReload: () => void,
  setStatus: SetStatus,
): (trackId: string, edits: VideoEdit[]) => Promise<void> {
  return useCallback(
    async (trackId: string, edits: VideoEdit[]) => {
      const path = `${project === "." ? "" : `${project}/`}video_tracks/${trackId}.yaml`;
      try {
        const { content } = await api.read(path);
        const before = listVideoPlacements(content);
        let next = content;
        for (const e of edits) {
          next = setVideoPlacementFieldAt(next, e.index, e.field, e.value);
          // A head trim moves the in-point, and the keys go with it so they stay on their frames (song-video docs/animation.md).
          const was = before[e.index];
          if (e.field === "source_from" && was)
            next = shiftVideoAnimationAt(
              next,
              e.index,
              e.value - was.sourceFrom,
            );
        }
        if (next === content) return; // no such placement — nothing to write, nothing to say
        await api.write(path, next);
        bumpReload();
      } catch (err) {
        setStatus((err as Error).message, "error");
      }
    },
    [project, bumpReload, setStatus],
  );
}
