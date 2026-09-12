// MixerColumn.tsx — the column BETWEEN the two decks: a channel fader and a meter per deck, and
// the crossfader under them. That is a mixing desk's own layout, and the reason this column exists
// at all: it used to be three spacers holding one slider. See ../../docs/mix.md.
//
// The meters read the engine's state frames DIRECTLY, each on its own subscription, because a
// level arrives 20 times a second and a value read higher up would re-render the desk that often.

import {
  clipLatch,
  FLOOR_DB,
  HOT_DB,
  meterFill,
} from "@studio/engine-browser/meter";
import {
  EngineStore,
  useEngineStoreOrNull,
  useStoreState,
} from "@studio/engine-browser/store";
import { useEffect, useRef, useState } from "react";
import { type DeckId, LEVEL_DB, MIX_CENTRE } from "../deckVocabulary";
import { type DeskLayout, underWave } from "../deskLayout";

/** `gap-3` between the column's stacked pieces — the same one the deck columns use. */
const GAP = 12;

/** How far the CROSSFADER reaches past this column, each side: the deck row's `gap-4`, the channel
 * strip's `w-16`, and the deck section's `gap-2`. That is the distance from this column's edge to
 * the edge of a deck's cue row, which is where that fader must end — ../../docs/mix.md.
 *
 * The channel faders above it do NOT bleed: they are per-deck controls and stay in their column. */
export const CROSSFADE_BLEED = 16 + 64 + 8;

/** Stood in for a host that provides no store, so the hooks below stay unconditional.
 *
 * Never written to, so every selector reads the initial frame and every meter sits at the floor.
 * The alternative — a conditional `useStoreState` — is not a thing React allows. */
const SILENT = new EngineStore();

/** One track's output level in dB, off whichever store the host provided. */
function useLevelDb(trackId: string | null, order: readonly string[]): number {
  const store = useEngineStoreOrNull() ?? SILENT;
  return useStoreState(store, (s) => {
    if (!trackId) return FLOOR_DB;
    const i = order.indexOf(trackId);
    const db = i < 0 ? FLOOR_DB : (s.levels[i] ?? FLOOR_DB);
    // Quantised to the half-decibel HERE, in the selector: a bar eight pixels wide cannot show more,
    // and an unrounded dB changes every frame, which is a re-render per frame for nothing.
    return Number.isFinite(db) ? Math.round(db * 2) / 2 : FLOOR_DB;
  });
}

/** A vertical bar, filled from the bottom — the scale is `@studio/engine-browser/meter`'s, shared
 *  with st0's header meter so the two read a signal alike. See ../../docs/mix.md. */
function Meter({ db }: { db: number }) {
  const fill = meterFill(db);
  return (
    <div
      className="relative w-1.5 shrink-0 overflow-hidden rounded-full bg-foreground/15"
      title={`niveau ${db <= FLOOR_DB ? "silence" : `${db.toFixed(1)} dB`}`}
    >
      {/* Scaled and not resized: a height would reflow this column every frame the engine speaks. */}
      <div
        className={`absolute inset-x-0 bottom-0 h-full origin-bottom rounded-full ${
          db >= HOT_DB ? "bg-amber-400" : "bg-emerald-400"
        }`}
        style={{ transform: `scaleY(${fill})` }}
      />
    </div>
  );
}

/** The MASTER, for the footer: one horizontal bar and a clip light that survives the pass.
 *
 * Desk-wide, so it sits in the desk-wide row rather than in either deck's column. It is the only
 * meter here that says anything about the blend — a channel meter is read PRE-fader. */
export function MasterMeter() {
  const store = useEngineStoreOrNull() ?? SILENT;
  const db = useStoreState(store, (s) => Math.round(s.master * 2) / 2);
  const overload = useStoreState(store, (s) => s.masterClipped);
  const playing = useStoreState(store, (s) => s.playing);

  const [clipped, setClipped] = useState(false);
  const wasPlaying = useRef(playing);
  useEffect(() => {
    setClipped((lit) => clipLatch(lit, overload, playing, wasPlaying.current));
    wasPlaying.current = playing;
  }, [overload, playing]);

  return (
    <div
      className="flex shrink-0 items-center gap-1.5"
      title={
        `sortie ${db <= FLOOR_DB ? "silence" : `${db.toFixed(1)} dB`}` +
        (clipped ? " — it clipped since playback started" : "")
      }
    >
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-foreground/15">
        <div
          className={`absolute inset-y-0 left-0 w-full origin-left rounded-full ${
            db >= HOT_DB ? "bg-amber-400" : "bg-emerald-400"
          }`}
          style={{ transform: `scaleX(${meterFill(db)})` }}
        />
      </div>
      {/* Always drawn, dark when nothing clipped: a light only there when it is on cannot be checked. */}
      <span
        aria-label={clipped ? "it clipped" : "no clipping"}
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          clipped
            ? "bg-red-500 shadow-[0_0_4px_1px] shadow-red-500/60"
            : "bg-foreground/20"
        }`}
      />
    </div>
  );
}

/** One deck's channel fader, with its meter against it. In DECIBELS — see ../../docs/mix.md. */
function ChannelFader({
  side,
  db,
  live,
  level,
  onChange,
}: {
  side: "A" | "B";
  /** What the METER reads — the strip, PRE-fader, which is what a trim is set against. */
  db: number;
  /** Does the project wire a channel fader at all? Unwired greys it rather than lying. */
  live: boolean;
  /** Where the fader is, in dB. */
  level: number;
  onChange: (dB: number) => void;
}) {
  const [lo, hi] = LEVEL_DB;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-1">
      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-1.5">
        {/* Vertical by WRITING MODE, which is the one way a native range goes upright and keeps
            its keyboard behaviour — `appearance: slider-vertical` is gone from both engines. */}
        <input
          type="range"
          min={lo}
          max={hi}
          step={0.5}
          value={level}
          disabled={!live}
          aria-label={`deck ${side}'s level`}
          title={
            live
              ? `deck ${side}'s level — ${level > 0 ? "+" : ""}${level.toFixed(1)} dB, double-click to go back to unity`
              : `this deck has no channel fader wired — connect \`deck${side}.level\` in surfaces/`
          }
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => live && onChange(0)}
          className={`[writing-mode:vertical-lr] [direction:rtl] w-3 accent-foreground ${
            live ? "cursor-ns-resize" : "opacity-40"
          }`}
        />
        <Meter db={db} />
      </div>
      {/* The letter under it, so the two faders are told apart without reading the tooltip. */}
      <span className="shrink-0 font-semibold text-xs leading-none">
        {side}
      </span>
    </div>
  );
}

/** The whole middle column: the two channel faders over the crossfader — ../../docs/mix.md.
 *
 * BOTTOM-ANCHORED, like a deck's own column: the slack a tall desk has falls above the faders
 * rather than under the crossfader. And the crossfader sits in a box exactly as tall as the
 * WAVEFORM, padded below by `underWave`, so its line is the waveform's — the two bands the
 * crossfader mixes. See ../../docs/deskLayout.md. */
export function MixerColumn({
  mix,
  layout,
  head,
  ready,
  levels,
  levelLive,
  meterTracks,
  trackOrder,
  onLevel,
  onChange,
  quantise,
  onQuantise,
}: {
  mix: number;
  layout: DeskLayout;
  /** How tall the record row beside this column is — the disc, or the stem block when there is none. */
  head: number;
  ready: boolean;
  /** Each deck's channel fader, in dB. */
  levels: Record<DeckId, number>;
  levelLive: Record<DeckId, boolean>;
  /** Which TRACK each deck's meter reads — the strip, resolved from its binding by the caller. */
  meterTracks: Record<DeckId, string | null>;
  /** …and the order those track ids are indexed in, which is the compiled document's. */
  trackOrder: readonly string[];
  onLevel: (deck: DeckId, dB: number) => void;
  onChange: (mix: number) => void;
  /** Do loop edges and beat jumps land on the grid? ONE switch for the desk — ../../docs/loop.md. */
  quantise: boolean;
  onQuantise: () => void;
}) {
  return (
    <div className="flex w-40 shrink-0 flex-col items-center gap-3">
      {/* The faders keep the height they had; `mt-auto` below is what hangs the group off the foot. */}
      <div
        className="mt-auto flex w-full shrink-0 justify-center gap-4"
        style={{ height: head + layout.waveform + GAP }}
      >
        {(["deckA", "deckB"] as const).map((deck, i) => (
          <FaderPair
            key={deck}
            side={i === 0 ? "A" : "B"}
            track={meterTracks[deck]}
            trackOrder={trackOrder}
            live={levelLive[deck]}
            level={levels[deck]}
            onLevel={(v) => onLevel(deck, v)}
          />
        ))}
      </div>
      {/* The crossfader and the row under it, GAPLESS: together they are exactly as tall as a
          deck's waveform and everything below it, so the crossfader's line IS the waveform's —
          which is the pair of bands it mixes. See ../../docs/deskLayout.md. */}
      <div className="flex w-full shrink-0 flex-col">
        {/* A COLUMN, so the row below stretches on the cross axis — which is the width here. */}
        <div
          className="flex w-full flex-col justify-center"
          style={{ height: layout.waveform }}
        >
          {/* `self-stretch` plus the bleed: a stretched item is sized to the container MINUS its
              margins, so these two negatives make the row the column plus both channel strips —
              edge to edge between the waveforms. `w-full` is not the same thing and does not work
              here: it resolves to a flat 100% and the bleed then only shifts the row left. */}
          <div
            className="relative z-10 flex h-7 items-center gap-2 self-stretch"
            style={{
              marginLeft: -CROSSFADE_BLEED,
              marginRight: -CROSSFADE_BLEED,
            }}
          >
            <span className="w-3 shrink-0 text-center font-semibold text-xs">
              A
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mix}
              onChange={(e) => onChange(Number(e.target.value))}
              disabled={!ready}
              className="min-w-0 flex-1 accent-foreground"
              aria-label="crossfade between deck A and deck B"
            />
            <span className="w-3 shrink-0 text-center font-semibold text-xs">
              B
            </span>
          </div>
        </div>
        {/* The cue row's band, spent on the two things the desk has that a deck does not. */}
        <div
          className="flex w-full items-center justify-center gap-3"
          style={{ height: underWave(layout) }}
        >
          {/* Drawn ONCE though both decks obey it: two buttons that always agreed would say less. */}
          <button
            type="button"
            onClick={onQuantise}
            title={
              quantise
                ? "quantise: the loops and the jumps land on the beat"
                : "quantise off: they land where the hand puts them"
            }
            className={`h-6 w-8 rounded border font-mono text-[10px] ${
              quantise
                ? "border-amber-500 bg-amber-500 text-white"
                : "border-border bg-background text-muted-foreground"
            }`}
          >
            Q
          </button>
          {/* Double-click the readout to recentre: the one position a drag never lands on exactly. */}
          {layout.title ? (
            <button
              type="button"
              onDoubleClick={() => onChange(MIX_CENTRE)}
              title="double-clic : recentrer"
              className="font-mono text-muted-foreground text-xs tabular-nums"
            >
              {Math.round(mix * 100)}%
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** One column of the pair — its own component so the level subscription re-renders one bar. */
function FaderPair({
  side,
  track,
  trackOrder,
  live,
  level,
  onLevel,
}: {
  side: "A" | "B";
  track: string | null;
  trackOrder: readonly string[];
  live: boolean;
  level: number;
  onLevel: (dB: number) => void;
}) {
  // Subscribed HERE, in the leaf, so a frame moves this bar and not the desk around it.
  const db = useLevelDb(track, trackOrder);
  return (
    <ChannelFader
      side={side}
      db={db}
      live={live}
      level={level}
      onChange={onLevel}
    />
  );
}
