// A MusicXML or Guitar Pro score, drawn and played by alphaTab — the one module that imports it,
// loaded lazily by the Sheet tab so no other screen pays for the library (../docs/score.md).
// What reads wrong: transposition is ONE setting for display and playback, never also
// changeTrackTranspositionPitch, which adds on top and would shift the sound twice.

import {
  AlphaTabApi,
  LayoutMode,
  type model,
  PlayerMode,
  ScrollMode,
} from "@coderline/alphatab";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface ScoreState {
  /** The score is drawn, so Play can be pressed; the player itself loads on that first press. */
  ready: boolean;
  /** The player and its soundfont are loading, after the first Play. */
  loading: boolean;
  playing: boolean;
}

export interface ScoreViewHandle {
  playPause(): void;
  stop(): void;
}

interface Props {
  /** Where the file is served; fetched here with the session cookie. */
  url: string;
  /** Semitones, applied to every pitched track. */
  transpose: number;
  scale: number;
  onState?: (state: ScoreState) => void;
  onError?: (error: Error) => void;
}

/** The per-track shifts alphaTab takes; a drum track has no key to move, so it stays at 0. */
function pitchesFor(score: model.Score, transpose: number): number[] {
  return score.tracks.map((t) =>
    t.staves.some((s) => s.isPercussion) ? 0 : transpose,
  );
}

export const ScoreView = forwardRef<ScoreViewHandle, Props>(function ScoreView(
  { url, transpose, scale, onState, onError },
  ref,
) {
  const viewport = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<AlphaTabApi | null>(null);
  // Read by the load, so a transpose or zoom chosen before the file arrived still applies.
  const latest = useRef({ transpose, scale, onState, onError });
  latest.current = { transpose, scale, onState, onError };

  // Play pressed before the player was ready: honoured once it is, or dropped by a second press.
  const playWhenReady = useRef(false);
  const enablePlayer = useRef<() => void>(() => {});

  useImperativeHandle(ref, () => ({
    playPause: () => {
      const tab = api.current;
      if (!tab) return;
      if (tab.settings.player.playerMode !== PlayerMode.Disabled) {
        if (tab.isReadyForPlayback) tab.playPause();
        else playWhenReady.current = !playWhenReady.current;
        return;
      }
      playWhenReady.current = true;
      enablePlayer.current();
    },
    stop: () => {
      playWhenReady.current = false;
      api.current?.stop();
    },
  }));

  useEffect(() => {
    if (!host.current || !viewport.current) return;
    // Under the app's base, in dev and in the image alike: the Vite plugin copies both folders there.
    const base = import.meta.env.BASE_URL;
    const tab = new AlphaTabApi(host.current, {
      core: { fontDirectory: `${base}font/` },
      display: { scale: latest.current.scale, layoutMode: LayoutMode.Page },
      player: {
        // The 1.3 MB soundfont and the synth worker load on the first Play, not on every score opened (../docs/score.md).
        playerMode: PlayerMode.Disabled,
        soundFont: `${base}soundfont/sonivox.sf2`,
        enableCursor: true,
        enableUserInteraction: true,
        // One vertical column, followed by the cursor: page layout never turns a page (../docs/score.md).
        scrollMode: ScrollMode.Continuous,
        scrollElement: viewport.current,
      },
    });
    api.current = tab;
    let playing = false;
    let ready = false;
    let loading = false;
    const report = () => latest.current.onState?.({ ready, loading, playing });
    playWhenReady.current = false;
    enablePlayer.current = () => {
      tab.settings.player.playerMode = PlayerMode.EnabledSynthesizer;
      tab.updateSettings();
      loading = true;
      report();
    };

    const offs = [
      tab.scoreLoaded.on((score) => {
        tab.settings.notation.transpositionPitches = pitchesFor(
          score,
          latest.current.transpose,
        );
        tab.updateSettings();
        ready = true;
        report();
      }),
      tab.playerReady.on(() => {
        loading = false;
        report();
        if (playWhenReady.current) {
          playWhenReady.current = false;
          tab.play();
        }
      }),
      tab.playerStateChanged.on((e) => {
        playing = e.state === 1;
        report();
      }),
      tab.error.on((e) => latest.current.onError?.(e)),
    ];

    const aborted = new AbortController();
    fetch(url, { credentials: "include", signal: aborted.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.arrayBuffer();
      })
      .then((bytes) => tab.load(new Uint8Array(bytes)))
      .catch((e: unknown) => {
        if (!aborted.signal.aborted) latest.current.onError?.(e as Error);
      });

    return () => {
      aborted.abort();
      for (const off of offs) off();
      tab.destroy();
      api.current = null;
    };
  }, [url]);

  useEffect(() => {
    const tab = api.current;
    if (!tab?.score) return;
    tab.settings.notation.transpositionPitches = pitchesFor(
      tab.score,
      transpose,
    );
    tab.updateSettings();
    tab.render();
  }, [transpose]);

  useEffect(() => {
    const tab = api.current;
    if (!tab || tab.settings.display.scale === scale) return;
    tab.settings.display.scale = scale;
    tab.updateSettings();
    tab.render();
  }, [scale]);

  return (
    <div ref={viewport} className="score-viewport">
      <div ref={host} />
    </div>
  );
});
