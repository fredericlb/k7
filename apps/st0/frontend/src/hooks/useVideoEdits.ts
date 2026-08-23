// useVideoEdits.ts — commit a finished picture drag to the lane's own file. Shared by the shell's
// timeline pane and by a timeline surface alone on a second device, which drag the same clips.
// See ../../docs/picture.md.

import { setVideoPlacementField } from "@studio/song/yaml/videoTrackFile";
import { useCallback } from "react";
import { api } from "../api";
import type { VideoEdit } from "../components/TimelineTab";

/**
 * Apply a finished picture drag to the lane's own file.
 *
 * A SURGICAL text rewrite, not a re-serialisation: these files carry the comments that document
 * the format, and a round trip through the parser would delete every one of them.
 * `setVideoPlacementField` edits by REF, so a placement that moved in the file between render and
 * drop is still the one that was grabbed.
 *
 * Every edit of the gesture is applied to ONE buffer and written once. Trimming a head is two
 * fields (three on a length-0 shot) describing a single drag; writing them separately would be two
 * reads of the same file, the second built on the text before the first.
 *
 * Not a COMMAND, unlike every audio edit this app makes: the CLI has no verb for a picture
 * placement. Which is also why it is a hook rather than a line in the two hosts — a write nobody
 * can spell as a command is one there is no second implementation of.
 *
 * @param project the open project, workspace-relative — `.` for a lone-project clone.
 */
export function useVideoEdits(
  project: string,
  bumpReload: () => void,
  setStatus: (s: string) => void,
): (trackId: string, edits: VideoEdit[]) => Promise<void> {
  return useCallback(
    async (trackId: string, edits: VideoEdit[]) => {
      const path = `${project === "." ? "" : `${project}/`}video_tracks/${trackId}.yaml`;
      try {
        const { content } = await api.read(path);
        let next = content;
        for (const e of edits)
          next = setVideoPlacementField(next, e.ref, e.field, e.value);
        if (next === content) return; // no such placement — nothing to write, nothing to say
        await api.write(path, next);
        bumpReload();
      } catch (err) {
        setStatus((err as Error).message);
      }
    },
    [project, bumpReload, setStatus],
  );
}
