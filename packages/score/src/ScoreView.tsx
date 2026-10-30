// A MusicXML score drawn by Verovio and played through a SoundFont, with the notes being played lit up.
// Loaded lazily by the Sheet tab, so no other screen pays for either library (../docs/score.md).
// What reads wrong: the MIDI is always the whole score; a part chosen changes only what is drawn.

import {
  forwardRef,
  type MouseEvent,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { VerovioToolkit } from "verovio/esm";
import { engraver, midiBytes } from "./engraver.ts";
import { keepPart, musicXmlOf, partsOf } from "./musicxml.ts";
import { ScorePlayer } from "./player.ts";

export interface ScoreState {
  /** The score is drawn, so Play can be pressed; the player itself loads on that first press. */
  ready: boolean;
  /** The player and its soundfont are loading, after the first Play. */
  loading: boolean;
  playing: boolean;
  /** Each part's name as the file gives it, in score order; empty until the score is read. */
  parts: string[];
}

export interface ScoreViewHandle {
  playPause(): void;
  stop(): void;
}

interface Props {
  /** Where the file is served; fetched here with the session cookie. */
  url: string;
  /** Semitones, applied to what is drawn and what is played alike. */
  transpose: number;
  scale: number;
  /** The one part drawn, by index into `parts`; null or left out draws every part. */
  part?: number | null;
  onState?: (state: ScoreState) => void;
  onError?: (error: Error) => void;
}

// Verovio's size at a zoom of 1: its own 100 draws a staff far taller than a page of text.
const BASE_SCALE = 40;
const LAYOUT = {
  breaks: "auto",
  adjustPageHeight: true,
  footer: "none",
  svgHtml5: true,
  pageMarginLeft: 30,
  pageMarginRight: 30,
  pageMarginTop: 30,
  pageMarginBottom: 30,
};
const PLAYING = "score-playing";

export const ScoreView = forwardRef<ScoreViewHandle, Props>(function ScoreView(
  { url, transpose, scale, part = null, onState, onError },
  ref,
) {
  const viewport = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  // Read by the loads, so a transpose, zoom or part chosen before the file arrived still applies.
  const latest = useRef({ transpose, scale, part, onState, onError });
  latest.current = { transpose, scale, part, onState, onError };

  const tk = useRef<VerovioToolkit | null>(null);
  const xml = useRef<string | null>(null);
  const midi = useRef<ArrayBuffer | null>(null);
  const player = useRef<ScorePlayer | null>(null);
  const starting = useRef(false);
  const state = useRef<ScoreState>({
    ready: false,
    loading: false,
    playing: false,
    parts: [],
  });
  const lit = useRef<Element[]>([]);
  const frame = useRef(0);

  const report = (patch: Partial<ScoreState>) => {
    state.current = { ...state.current, ...patch };
    latest.current.onState?.(state.current);
  };

  const unlight = () => {
    for (const el of lit.current) el.classList.remove(PLAYING);
    lit.current = [];
  };

  // The notes sounding at `ms` lit, and kept in view when they leave it.
  const light = (ms: number) => {
    const t = tk.current;
    const h = host.current;
    const v = viewport.current;
    if (!t || !h || !v) return;
    const ids = t.getElementsAtTime(ms).notes ?? [];
    if (ids.length === 0) return;
    unlight();
    lit.current = ids.flatMap((id) => [
      ...h.querySelectorAll(`[data-id="${CSS.escape(id)}"]`),
    ]);
    for (const el of lit.current) el.classList.add(PLAYING);
    const first = lit.current[0]?.getBoundingClientRect();
    const box = v.getBoundingClientRect();
    if (first && (first.top < box.top || first.bottom > box.bottom))
      v.scrollTop += first.top - box.top - box.height / 3;
  };

  const follow = () => {
    cancelAnimationFrame(frame.current);
    const tick = () => {
      const p = player.current;
      if (!p?.playing) return;
      light(p.time * 1000);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  // Lay the loaded file out to the viewport's width at the zoom, as one column of pages.
  const draw = () => {
    const t = tk.current;
    const h = host.current;
    const v = viewport.current;
    if (!t || !h || !v) return;
    const vrvScale = Math.round(BASE_SCALE * latest.current.scale);
    const width = v.clientWidth || 800;
    t.setOptions({
      scale: vrvScale,
      pageWidth: Math.max(100, Math.round((width * 100) / vrvScale)),
    });
    t.redoLayout();
    let svg = "";
    for (let p = 1; p <= t.getPageCount(); p++) svg += t.renderToSVG(p);
    lit.current = [];
    h.innerHTML = svg;
  };

  // The whole score's MIDI first, then the part drawn: the toolkit holds one file at a time.
  const engrave = () => {
    const t = tk.current;
    const source = xml.current;
    if (!t || source === null) return;
    t.setOptions({ transpose: String(latest.current.transpose || "") });
    if (!t.loadData(source))
      throw new Error("Verovio could not read this score");
    midi.current = midiBytes(t.renderToMIDI());
    const shown = latest.current.part;
    if (shown !== null) t.loadData(keepPart(source, shown));
    // The timing behind the lit notes is computed once per file loaded.
    t.renderToTimemap();
    draw();
    const p = player.current;
    if (p && midi.current) void p.load(midi.current, p.time);
  };

  const fail = (e: unknown) =>
    latest.current.onError?.(e instanceof Error ? e : new Error(String(e)));

  useImperativeHandle(ref, () => ({
    playPause: () => {
      const p = player.current;
      if (p) {
        if (p.playing) {
          p.pause();
          report({ playing: false });
        } else
          void p.play().then(() => {
            report({ playing: true });
            follow();
          }, fail);
        return;
      }
      // The synth and its soundfont load on the first Play (../docs/score.md).
      if (starting.current || !midi.current) return;
      starting.current = true;
      report({ loading: true });
      const base = import.meta.env.BASE_URL;
      void ScorePlayer.create(`${base}soundfont/sonivox.sf3`)
        .then(async (created) => {
          player.current = created;
          created.onEnd(() => {
            unlight();
            report({ playing: false });
          });
          if (midi.current) await created.load(midi.current);
          report({ loading: false });
          await created.play();
          report({ playing: true });
          follow();
        })
        .catch((e) => {
          report({ loading: false });
          fail(e);
        })
        .finally(() => {
          starting.current = false;
        });
    },
    stop: () => {
      player.current?.stop();
      cancelAnimationFrame(frame.current);
      unlight();
      report({ playing: false });
    },
  }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: one load per file; everything else is read through refs
  useEffect(() => {
    const aborted = new AbortController();
    state.current = { ready: false, loading: false, playing: false, parts: [] };
    void (async () => {
      const res = await fetch(url, {
        credentials: "include",
        signal: aborted.signal,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await musicXmlOf(new Uint8Array(await res.arrayBuffer()));
      const t = await engraver();
      if (aborted.signal.aborted) return t.destroy();
      t.setOptions(LAYOUT);
      tk.current = t;
      xml.current = text;
      engrave();
      report({ ready: true, parts: partsOf(text).map((p) => p.name) });
    })().catch((e: unknown) => {
      if (!aborted.signal.aborted) fail(e);
    });
    return () => {
      aborted.abort();
      cancelAnimationFrame(frame.current);
      player.current?.destroy();
      player.current = null;
      tk.current?.destroy();
      tk.current = null;
      xml.current = null;
      midi.current = null;
    };
  }, [url]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `engrave` reads both through `latest`
  useEffect(() => {
    try {
      engrave();
    } catch (e) {
      fail(e);
    }
  }, [transpose, part]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `draw` reads the zoom through `latest`
  useEffect(() => draw(), [scale]);

  // A new width is a new layout: the systems wrap to the panel, and to the screen when full.
  // biome-ignore lint/correctness/useExhaustiveDependencies: observed once; `draw` reads everything through refs
  useEffect(() => {
    const v = viewport.current;
    if (!v) return;
    let width = v.clientWidth;
    let timer = 0;
    const seen = new ResizeObserver(() => {
      if (Math.abs(v.clientWidth - width) < 20) return;
      width = v.clientWidth;
      clearTimeout(timer);
      timer = window.setTimeout(draw, 150);
    });
    seen.observe(v);
    return () => {
      clearTimeout(timer);
      seen.disconnect();
    };
  }, []);

  // A note clicked is where playback goes.
  const seekTo = (e: MouseEvent) => {
    const note = (e.target as Element).closest?.('[data-class="note"]');
    const id = note?.getAttribute("data-id");
    const t = tk.current;
    if (!id || !t || !player.current) return;
    const ms = t.getTimeForElement(id);
    player.current.seek(ms / 1000);
    light(ms);
  };

  return (
    <div ref={viewport} className="score-viewport">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a note is a pointer's way in; the toolbar is the keyboard's */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the notes inside are what answers the click */}
      <div ref={host} className="score-pages" onClick={seekTo} />
    </div>
  );
});
