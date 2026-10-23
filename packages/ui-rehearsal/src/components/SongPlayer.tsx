// The reference track: a seekable WAVEFORM and the Original/Instrumental switch — what you PLAY,
// and nothing that changes the file, which the ⋮ menu owns. On desktop it is a panel of the page's
// right rail; on a narrow screen it stays in the flow.
//
// The `<audio>` element is still the transport, drawn by nobody: it streams from pl8, the shape
// comes from the backend, and a click on it seeks AND plays. Collapsing the panel HIDES this
// element and never unmounts it: the music must not stop, and the timed lyrics follow it.
// Why k7 keeps no copy of the bytes: ../../docs/audio.md.

import { Button } from "@frediverse/ui/button";
import { Headphones, Pause, Play } from "@frediverse/ui/icons";
import { Switch } from "@frediverse/ui/switch";
import { Waveform } from "@studio/recorder";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { usePitchShift } from "../hooks/usePitchShift";
import { usePl8Stream } from "../hooks/usePl8Stream";
import { m } from "../paraglide/messages.js";
import type { Song, SongEnvelope } from "../types";

interface Props {
  song: Song;
  /** The `<audio>` element, for the lyrics that follow and seek it. */
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  /** Semitones the song is read in: the track follows, its tempo untouched. */
  transpose?: number;
  /** Draw it as a rail panel with its own toggle, rather than in the page's flow. */
  floating?: boolean;
  open?: boolean;
  onToggle?: () => void;
}

export function SongPlayer({
  song,
  audioRef,
  transpose = 0,
  floating = false,
  open = true,
  onToggle,
}: Props) {
  const own = useRef<HTMLAudioElement | null>(null);
  const element = audioRef ?? own;
  // The element as STATE: it appears only once the song has a track, and what listens to it must rebind then.
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const bindAudio = useCallback(
    (node: HTMLAudioElement | null) => {
      element.current = node;
      setAudioEl(node);
    },
    [element],
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
  const playing =
    instrumental && version === "instrumental" ? "instrumental" : "original";

  // The switch keeps the position and the play state across the source change.
  const switchTo = (next: "original" | "instrumental") => {
    const el = element.current;
    if (el) resume.current = { at: el.currentTime, playing: !el.paused };
    setVersion(next);
  };

  // The track's shape, measured by the backend and kept — the browser decodes nothing.
  const [shape, setShape] = useState<SongEnvelope | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the track's NAME is the trigger — a replaced file has another shape.
  useEffect(() => {
    let alive = true;
    setShape(null);
    if (!song.audio) return;
    void api
      .getSongEnvelope(song.id)
      .then((s) => alive && setShape(s))
      .catch(() => {}); // no shape is a drawing problem, never a reason to stop the player
    return () => {
      alive = false;
    };
  }, [song.id, song.audio?.name]);

  // Where the playhead is, for the waveform alone: the lyrics listen to the same element themselves.
  const [time, setTime] = useState(0);
  // Whether it is rolling — NOT `playing` below, which says which VERSION is on.
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const el = audioEl;
    if (!el) return;
    const tick = () => setTime(el.currentTime);
    const sync = () => setRunning(!el.paused);
    el.addEventListener("timeupdate", tick);
    el.addEventListener("seeked", tick);
    el.addEventListener("play", sync);
    el.addEventListener("pause", sync);
    // The end pauses the element without a `pause` event, and the button would stay on ⏸.
    el.addEventListener("ended", sync);
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("seeked", tick);
      el.removeEventListener("play", sync);
      el.removeEventListener("pause", sync);
      el.removeEventListener("ended", sync);
    };
  }, [audioEl]);

  /** A click on the shape goes there and plays: seeking and starting are one gesture. */
  const seek = (seconds: number) => {
    const el = element.current;
    if (!el) return;
    el.currentTime = seconds;
    void el.play();
  };

  /** …and the button is what the shape cannot say: stop where you are, and start again from there. */
  const toggle = () => {
    const el = element.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  // No track, nothing to draw: the song page offers the first one in its ⋮ menu.
  if (!song.audio) return null;

  const body = (
    <div className="song-player">
      <audio
        ref={bindAudio}
        crossOrigin="use-credentials"
        // A replaced track is another library path, so another URL: nothing stale to bust.
        src={
          (playing === "instrumental" && instrumentalUrl) ||
          audioUrl ||
          undefined
        }
        onLoadedMetadata={(e) => {
          const r = resume.current;
          if (!r) return;
          resume.current = null;
          e.currentTarget.currentTime = r.at;
          if (r.playing) void e.currentTarget.play();
        }}
        className="song-player-audio"
      >
        <track kind="captions" />
      </audio>

      {/* The instrumental is the same performance at the same timing, so it wears the track's shape. */}
      {shape && (
        <Waveform
          envelope={shape}
          duration={shape.seconds}
          currentTime={time}
          height={64}
          onSeek={seek}
        />
      )}

      {/* In the rail the panel's header carries it, so it answers even folded. */}
      {!floating && (
        <Button
          variant="secondary"
          className="song-player-play"
          onClick={toggle}
          aria-pressed={running}
        >
          {running ? (
            <>
              <Pause className="size-4" /> {m["common.pause"]()}
            </>
          ) : (
            <>
              <Play className="size-4" /> {m["common.play"]()}
            </>
          )}
        </Button>
      )}

      <div className="song-player-row">
        {/* One toggle rather than two buttons: there are two versions and they exclude each other. */}
        {instrumental && (
          <span className="song-player-version">
            <Switch
              checked={playing === "instrumental"}
              onCheckedChange={(on) =>
                switchTo(on ? "instrumental" : "original")
              }
              aria-label={m["player.instrumental"]()}
            />
            <span className="muted small">{m["player.instrumental"]()}</span>
          </span>
        )}
      </div>
    </div>
  );

  if (!floating) return body;

  return (
    <aside className={`rail-panel${open ? "" : " collapsed"}`}>
      <div className="rail-panel-head">
        <button
          type="button"
          className="rail-panel-toggle"
          onClick={onToggle}
          aria-expanded={open}
        >
          <Headphones className="size-4" />
          <span className="rail-panel-word">{m["player.title"]()}</span>
        </button>
        <button
          type="button"
          className="rail-panel-action"
          onClick={toggle}
          aria-pressed={running}
          aria-label={running ? m["common.pause"]() : m["common.play"]()}
          title={running ? m["common.pause"]() : m["common.play"]()}
        >
          {running ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
      </div>
      {/* Hidden, never unmounted: unmounting would stop the track and strand the lyrics. */}
      <div hidden={!open}>{body}</div>
    </aside>
  );
}
