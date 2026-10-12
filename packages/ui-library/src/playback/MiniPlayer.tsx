// MiniPlayer.tsx — the bar at the bottom: what is playing, how far in, and where the sound is
// coming out. It appears when a song starts and goes only when it is closed — including after
// the song ends. The ROW is @studio/ui-mini-player; what is here is the médiathèque's reading
// of it. See ../../docs/miniPlayer.md.

import { Disc3, ListVideo } from "@frediverse/ui/icons";
import { MiniPlayer as Bar } from "@studio/ui-mini-player";
import { useLabels } from "../host";
import { usePlayback } from "./PlaybackProvider";
import { QueueButton } from "./QueueButton";
import { playbackTargetInfo } from "./targets";

/** The album, which no field carries: the path's second-to-last segment IS it. */
function albumOf(path: string): string {
  const parts = path.split("/");
  return parts.length >= 4 ? parts[parts.length - 2] : "";
}

/** The bar cut down to what it says when nothing plays but the queue waits. */
function QueueOnly() {
  const { queue } = usePlayback();
  const l = useLabels().playback;
  return (
    <section
      aria-label={l.queueRegion}
      className="flex shrink-0 items-center gap-3 border-t bg-card px-3 py-2"
    >
      <ListVideo className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {l.queueWaiting(queue.length)}
      </span>
      <QueueButton />
    </section>
  );
}

export function MiniPlayer() {
  const {
    now,
    playing,
    position,
    duration,
    error,
    toggle,
    seek,
    close,
    queue,
  } = usePlayback();
  const l = useLabels().playback;

  /** The bar appears for a NON-EMPTY queue too, or the queue could not bring up its own button. */
  if (!now) return queue.length ? <QueueOnly /> : null;

  const { entry, target, version } = now;
  const artist =
    typeof entry.meta?.artist === "string" ? entry.meta.artist : "";
  // The entry's folder, not the master's file path: the master is the last segment of `path`.
  const album = albumOf(entry.path);
  const where = playbackTargetInfo(target);
  const WhereIcon = where.icon;
  const done = duration > 0 && position >= duration - 0.25 && !playing;

  return (
    <Bar
      icon={Disc3}
      title={entry.name}
      playing={playing}
      position={position}
      duration={duration}
      labels={l.bar}
      onToggle={toggle}
      onSeek={seek}
      onClose={close}
      meta={
        <>
          {/* Which version, when not the master: the strip above may point elsewhere entirely. */}
          {version ? (
            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {version}
            </span>
          ) : null}
          {/* Artist and album, each only when there is one: a placeholder dash is noise. */}
          {artist ? (
            <span className="min-w-0 truncate text-muted-foreground text-xs">
              {artist}
            </span>
          ) : null}
          {album ? (
            <span className="hidden min-w-0 truncate text-muted-foreground text-xs sm:inline">
              · {album}
            </span>
          ) : null}
        </>
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

      {/* What plays next — right of the row and before the close, being a playback control. */}
      <QueueButton />
    </Bar>
  );
}
