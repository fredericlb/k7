// useVideoEdits.ts — commit a finished picture drag to the lane's own file. Shared by the shell's
// timeline pane and by a timeline surface alone on a second device, which drag the same clips.
// See ../../docs/picture.md.

import { K7Document } from "@studio/k7x/document";
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
      const path = `${dir ? `${dir}/` : ""}video_tracks/${trackId}.k7x`;
      try {
        const { content } = await api.read(path);
        const doc = new K7Document(content);
        const before = listVideoPlacements(doc.at([]));
        for (const e of edits) {
          setVideoPlacementFieldAt(doc.at([]), e.index, e.field, e.value);
          // A head trim moves the in-point, and the keys go with it so they stay on their frames (song-video docs/animation.md).
          const was = before[e.index];
          if (e.field === "source_from" && was)
            shiftVideoAnimationAt(
              doc.at([]),
              e.index,
              e.value - was.sourceFrom,
            );
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
