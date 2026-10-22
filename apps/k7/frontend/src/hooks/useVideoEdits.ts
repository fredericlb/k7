// useVideoEdits.ts — commit a finished picture drag to the lane's file, or its timeline's. Shared by the shell's
// timeline pane and by a timeline surface alone on a second device, which drag the same clips.
// See ../../docs/picture.md.

import { K7Document } from "@studio/k7x/document";
import { timelineLaneOf } from "@studio/song-schema/timelineLane";
import {
  listVideoPlacements,
  setVideoPlacementFieldAt,
  shiftVideoAnimationAt,
} from "@studio/song-schema/yaml/videoTrackFile";
import { useCallback } from "react";
import { api } from "../api";
import { projectDir } from "../projectPaths";
import type { VideoEdit } from "../videoDrag";
import type { SetStatus } from "./useLogs";

/** Apply a finished picture drag to the lane's own file: values set by INDEX in one document, written once, and not a COMMAND. */
export function useVideoEdits(
  project: string,
  bumpReload: () => void,
  setStatus: SetStatus,
): (trackId: string, edits: VideoEdit[]) => Promise<void> {
  return useCallback(
    async (trackId: string, edits: VideoEdit[]) => {
      const dir = projectDir(project);
      // A timeline's lane, `<timeline>><lane>`, is a map in that timeline's file (song/docs/timelines.md).
      const tl = timelineLaneOf(trackId);
      const file = tl
        ? `timelines/${tl.timeline}.k7x`
        : `video_tracks/${trackId}.k7x`;
      const path = `${dir ? `${dir}/` : ""}${file}`;
      try {
        const { content } = await api.read(path);
        const doc = new K7Document(content);
        const pictures = tl ? doc.at([]).toJS() : null;
        const at = tl
          ? (
              (pictures as { pictures?: { lane?: unknown }[] } | null)
                ?.pictures ?? []
            ).findIndex((p) => p?.lane === tl.lane)
          : 0;
        if (at < 0) return; // the lane went away under the drag — nothing to write
        const lane = () => doc.at(tl ? ["pictures", at] : []);
        const before = listVideoPlacements(lane());
        for (const e of edits) {
          setVideoPlacementFieldAt(lane(), e.index, e.field, e.value);
          // A head trim moves the in-point, and the keys go with it so they stay on their frames (song-video docs/animation.md).
          const was = before[e.index];
          if (e.field === "source_from" && was)
            shiftVideoAnimationAt(lane(), e.index, e.value - was.sourceFrom);
        }
        const next = doc.toString();
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
