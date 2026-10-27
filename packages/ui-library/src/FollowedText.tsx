// FollowedText.tsx — a song's lyrics or chords as the host draws them, following the track: the
// timed line being sung while THIS song plays (any of its versions), and a tap that plays from a
// line. Only this small component reads the position, and the host's drawing is redone only when
// the line changes, never on every frame. See ../docs/songPlayer.md.

import { timecodesByLine } from "@studio/lyrics/lrc";
import { type ReactNode, useMemo } from "react";
import type { SongAttachmentView } from "./host";
import { usePlaybackPosition } from "./playback/position";
import { followedLine } from "./songExtras";
import type { SongTransport } from "./useSongTransport";

export function FollowedText({
  kind,
  text,
  transpose,
  transport,
  draw,
}: {
  kind: "lyrics" | "chords";
  text: string;
  transpose: number;
  transport: SongTransport;
  draw: (props: SongAttachmentView) => ReactNode;
}) {
  const following = transport.songLoaded;
  const { position } = usePlaybackPosition(following);
  const timings = useMemo(() => timecodesByLine(text), [text]);
  const activeLine = followedLine(timings, position, following);
  // A line plays only where there is audio: the loaded version, or the open tab's file.
  const canPlay = following || transport.path !== null;
  const onLineClick = canPlay ? transport.playFrom : undefined;
  return useMemo(
    () =>
      draw({
        kind,
        text,
        sheets: [],
        sheetUrl: () => "",
        transpose,
        activeLine,
        onLineClick,
      }),
    [draw, kind, text, transpose, activeLine, onLineClick],
  );
}
