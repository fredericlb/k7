// The reference track: the app's mini player at the foot of the page, with the Original/Instrumental
// switch in its row. The `<audio>` element is HERE and stays mounted while the bar is closed: the
// timed lyrics follow and seek it, and a tapped line brings the bar back by playing it.
// Why k7 keeps no copy of the bytes, and why the bar rather than a panel: ../../docs/audio.md.

import { Headphones } from "@frediverse/ui/icons";
import { Switch } from "@frediverse/ui/switch";
import { MiniPlayer } from "@studio/ui-mini-player";
import { useMiniPlayerDocked } from "@studio/ui-mini-player/dock";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePitchShift } from "../hooks/usePitchShift";
import { usePl8Stream } from "../hooks/usePl8Stream";
import { m } from "../paraglide/messages.js";
import type { Song } from "../types";

interface Props {
  song: Song;
  /** The `<audio>` element, for the lyrics that follow and seek it. */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** Semitones the song is read in: the track follows, its tempo untouched. */
  transpose?: number;
  /** Whether the bar is drawn; the element plays on either way. */
  open: boolean;
  /** The track started — from the bar, a lyric line or the header — so the bar is wanted. */
  onPlay: () => void;
  onClose: () => void;
}

export function SongBar({
  song,
  audioRef,
  transpose = 0,
  open,
  onPlay,
  onClose,
}: Props) {
  const docked = useMiniPlayerDocked();
  // The element as STATE: it appears only once the song has a track, and what listens to it must rebind then.
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const bindAudio = useCallback(
    (node: HTMLAudioElement | null) => {
      audioRef.current = node;
      setAudioEl(node);
    },
    [audioRef],
  );
  // Transposing the sheet transposes what you play along to — ../../docs/audio.md.
  usePitchShift(audioEl, transpose);
  // Original or instrumental: one element, so the lyrics keep following whichever plays.
  const [version, setVersion] = useState<"original" | "instrumental">(
    "original",
  );
  const resume = useRef<{ at: number; playing: boolean } | null>(null);
  // Both stream from pl8, where the library keeps them: k7 has no copy of either.
  const audioUrl = usePl8Stream(song.audio?.path);
  const instrumentalUrl = usePl8Stream(song.instrumental?.path);
  const instrumental =
    song.instrumental && instrumentalUrl ? song.instrumental : null;
  const current =
    instrumental && version === "instrumental" ? "instrumental" : "original";

  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the track's NAME is the trigger — a replaced file starts from nothing.
  useEffect(() => {
    setAt(0);
    setDuration(0);
    setError("");
  }, [song.id, song.audio?.name]);

  // The switch keeps the position and the play state across the source change.
  const switchTo = (next: "original" | "instrumental") => {
    const el = audioRef.current;
    if (el) resume.current = { at: el.currentTime, playing: !el.paused };
    setVersion(next);
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) return el.pause();
    // Past the end, play() rewinds by itself.
    el.play().catch((e: Error) => setError(e.message));
  };

  const close = () => {
    audioRef.current?.pause();
    onClose();
  };

  // No track, nothing to play: the song page offers the first one in its ⋮ menu.
  if (!song.audio) return null;

  const done = duration > 0 && at >= duration - 0.25 && !playing;

  const bar = (
    <MiniPlayer
      icon={Headphones}
      title={song.title}
      artist={song.artist}
      playing={playing}
      position={at}
      duration={duration}
      labels={{
        region: m["player.region"](),
        play: m["common.play"](),
        pause: m["common.pause"](),
        position: m["player.position"](),
        close: m["player.close"](),
      }}
      onToggle={toggle}
      onSeek={(s) => {
        if (audioRef.current) audioRef.current.currentTime = s;
        setAt(s);
      }}
      onClose={close}
      meta={
        song.artist ? (
          <span className="min-w-0 truncate text-muted-foreground text-xs">
            {song.artist}
          </span>
        ) : null
      }
      status={
        error ? (
          <span className="min-w-0 truncate text-destructive text-xs">
            {error}
          </span>
        ) : done ? (
          <span className="shrink-0 text-muted-foreground text-xs">
            {m["player.ended"]()}
          </span>
        ) : null
      }
    >
      {/* One toggle rather than two buttons: there are two versions and they exclude each other. */}
      {instrumental && (
        <span className="song-bar-version">
          <Switch
            checked={current === "instrumental"}
            onCheckedChange={(on) => switchTo(on ? "instrumental" : "original")}
            aria-label={m["player.instrumental"]()}
          />
          <span className="muted small">{m["player.instrumental"]()}</span>
        </span>
      )}
    </MiniPlayer>
  );

  return (
    <>
      <audio
        ref={bindAudio}
        crossOrigin="use-credentials"
        // A replaced track is another library path, so another URL: nothing stale to bust.
        src={
          (current === "instrumental" && instrumentalUrl) ||
          audioUrl ||
          undefined
        }
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          const r = resume.current;
          if (!r) return;
          resume.current = null;
          e.currentTarget.currentTime = r.at;
          if (r.playing) void e.currentTarget.play();
        }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onSeeked={(e) => setAt(e.currentTarget.currentTime)}
        onPlay={() => {
          setPlaying(true);
          onPlay();
        }}
        onPause={() => setPlaying(false)}
        // The end pauses the element without a `pause` event, and the button would stay on ⏸.
        onEnded={() => setPlaying(false)}
        onError={() => setError(m["player.cannotPlay"]())}
        className="hidden"
      >
        <track kind="captions" />
      </audio>

      {/* In a host's dock the bar is drawn there; standing alone, it is fixed at the foot of the column. */}
      {open && (docked ? bar : <div className="song-bar">{bar}</div>)}
    </>
  );
}
