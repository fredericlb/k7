// mediaSession.ts — the bar, told to the system as well: the lock screen, the notification shade and a
// headset's buttons read the browser's Media Session, which this fills from the bar's own props. On the
// Android app a WebView's session reaches nothing, so the app relays these same calls to a native one.
// See ../docs/miniPlayer.md.

import { useEffect, useRef } from "react";

/** What the system shows and what its buttons call: the bar's props, plus the two it has no room for. */
export interface MediaSessionProps {
  title: string;
  artist?: string;
  album?: string;
  playing: boolean;
  position: number;
  duration: number;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onClose: () => void;
  /** The next track, when the host has one to start; absent, the system offers no skip. */
  onNext?: () => void;
}

const ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "stop",
  "seekto",
  "seekbackward",
  "seekforward",
  "nexttrack",
];

/** The step a headset's or a lock screen's skip buttons take when they name none. */
const SKIP_SECONDS = 10;

/** A playhead further than this from where the last report says it should be is a seek worth telling. */
const DRIFT_SECONDS = 1;

const session =
  typeof navigator !== "undefined" && "mediaSession" in navigator
    ? navigator.mediaSession
    : null;

/** Some actions are refused by some browsers, which throw rather than ignore them. */
function handle(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    session?.setActionHandler(action, handler);
  } catch {}
}

export function useMediaSession(props: MediaSessionProps): void {
  // Handlers read the latest props, so they are registered once rather than on every frame of the playhead.
  const latest = useRef(props);
  latest.current = props;
  const { title, artist, album, playing, position, duration } = props;
  const hasNext = !!props.onNext;

  useEffect(() => {
    if (!session) return;
    session.metadata = new MediaMetadata({
      title,
      artist: artist ?? "",
      album: album ?? "",
    });
  }, [title, artist, album]);

  useEffect(() => {
    if (session) session.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  // The system extrapolates a playing position itself, so only a seek, a pause or a new length is reported.
  const told = useRef<{
    position: number;
    at: number;
    playing: boolean;
    duration: number;
  } | null>(null);
  useEffect(() => {
    if (!session?.setPositionState) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const now = performance.now();
    const last = told.current;
    const expected = last
      ? last.position + (last.playing ? (now - last.at) / 1000 : 0)
      : Number.NaN;
    if (
      last &&
      last.playing === playing &&
      last.duration === duration &&
      Math.abs(position - expected) < DRIFT_SECONDS
    )
      return;
    const at = Math.min(Math.max(0, position), duration);
    told.current = { position: at, at: now, playing, duration };
    try {
      session.setPositionState({ duration, position: at, playbackRate: 1 });
    } catch {}
  }, [position, duration, playing]);

  useEffect(() => {
    if (!session) return;
    const p = () => latest.current;
    handle("play", () => {
      if (!p().playing) p().onToggle();
    });
    handle("pause", () => {
      if (p().playing) p().onToggle();
    });
    handle("stop", () => p().onClose());
    handle("seekto", (d) => {
      if (d.seekTime != null) p().onSeek(d.seekTime);
    });
    handle("seekbackward", (d) =>
      p().onSeek(Math.max(0, p().position - (d.seekOffset ?? SKIP_SECONDS))),
    );
    handle("seekforward", (d) => {
      const to = p().position + (d.seekOffset ?? SKIP_SECONDS);
      p().onSeek(p().duration > 0 ? Math.min(to, p().duration) : to);
    });
    handle("nexttrack", hasNext ? () => p().onNext?.() : null);
    return () => {
      for (const a of ACTIONS) handle(a, null);
    };
  }, [hasNext]);

  // Gone with the bar: a closed player must not leave a lock-screen control that drives nothing.
  useEffect(
    () => () => {
      if (!session) return;
      session.metadata = null;
      session.playbackState = "none";
      told.current = null;
    },
    [],
  );
}
