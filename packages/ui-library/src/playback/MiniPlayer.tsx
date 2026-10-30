// MiniPlayer.tsx — the bar at the bottom: what is playing, how far in, and where the sound is
// coming out. It appears when a song starts and stays, even after the song ends: it has no close,
// since a host's dock would only draw its own bar in its place. The ROW is @studio/ui-mini-player;
// what is here is the médiathèque's reading of it: the title alone on the row, the rest behind the
// play button, and the waveform of what plays when that file has a shape. See ../../docs/miniPlayer.md.

import {
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@frediverse/ui/dropdown-menu";
import { Disc3 } from "@frediverse/ui/icons";
import { MiniPlayer as Bar } from "@studio/ui-mini-player";
import { useLabels } from "../host";
import { songRow } from "../songRows";
import { useSongShape } from "../songWaveform";
import { usePlayback } from "./PlaybackProvider";
import { usePlaybackPosition } from "./position";
import { playbackTargetInfo } from "./targets";
import { useInstrumentalMenu } from "./useInstrumentalMenu";
import { useStartNext } from "./useQueueAdvance";
import { WaveformTrack } from "./WaveformTrack";

export function MiniPlayer() {
  const { now, playing, error, toggle, seek, queue } = usePlayback();
  // The bar is what follows the playhead, so it alone re-renders with it.
  const { position, duration } = usePlaybackPosition();
  const l = useLabels().playback;
  // The skip the queue's own advance takes, offered to the system's controls while there is a next.
  const startNext = useStartNext();
  // The shape of the file PLAYING — the master, a variant or the instrumental — and none means the plain scrubber.
  const shape = useSongShape(now?.path ?? null);

  // Called before the early return: it is a hook, whatever the bar shows.
  const instrumental = useInstrumentalMenu();

  if (!now) return null;

  const { entry, target, version } = now;
  // Read as the songs' table reads them, so the two never name a song differently.
  const row = songRow(entry, false);
  const artist = row.artist;
  const album = row.album ?? "";
  const where = playbackTargetInfo(target);
  const WhereIcon = where.icon;
  // The bar says the title alone; who, which record and which version are behind the play button.
  const about = [artist, album, version].filter(Boolean);
  const playMenu =
    about.length || instrumental.item ? (
      <>
        {about.length ? (
          <DropdownMenuLabel className="font-normal">
            {artist ? (
              <span className="block truncate font-medium text-foreground">
                {artist}
              </span>
            ) : null}
            {album || version ? (
              <span className="block truncate text-muted-foreground text-xs">
                {[album, version].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </DropdownMenuLabel>
        ) : null}
        {about.length && instrumental.item ? <DropdownMenuSeparator /> : null}
        {instrumental.item}
      </>
    ) : undefined;
  const done = duration > 0 && position >= duration - 0.25 && !playing;

  return (
    <Bar
      icon={Disc3}
      title={entry.name}
      artist={artist}
      album={album}
      playing={playing}
      position={position}
      duration={duration}
      labels={l.bar}
      onToggle={toggle}
      playMenu={playMenu}
      onSeek={seek}
      onNext={queue.length ? startNext : undefined}
      track={
        shape ? (
          <WaveformTrack
            shape={shape}
            position={position}
            duration={duration}
            label={l.bar.position}
            onSeek={seek}
          />
        ) : undefined
      }
      status={
        // A failure outranks "done": both mean no sound, and only one of them is fine.
        error ? (
          <span className="min-w-0 truncate text-destructive text-xs">
            {error}
          </span>
        ) : done ? (
          <span className="shrink-0 text-muted-foreground text-xs">
            {l.done}
          </span>
        ) : null
      }
    >
      {/* Where the sound is, reported for what is PLAYING rather than for the destination. */}
      <span
        className="hidden shrink-0 items-center gap-1 text-muted-foreground text-xs sm:flex"
        title={l.targets[where.id].hint}
      >
        <WhereIcon className="h-3.5 w-3.5" />
        {l.targets[where.id].label}
      </span>

      {instrumental.dialog}
    </Bar>
  );
}
