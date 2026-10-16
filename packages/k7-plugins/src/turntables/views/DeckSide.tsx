// DeckSide.tsx — one deck's whole column: the record, its transport and cues, its FX row and the
// sync button. Split out of MixView.tsx, which mounts two of these and owns only what SITS BETWEEN
// them — the crossfade, the mixer and the set list. See ../../docs/mix.md.
//
// It DRAWS a deck and owns nothing about it: the document is `useDeckSet`, held above.

import { Button } from "@frediverse/ui/button";
import { Play, Square } from "@frediverse/ui/icons";
import {
  parseSongDrag,
  SONG_DRAG_TYPE,
  type SongDrag,
} from "@studio/mediatek/playlistItems";
import type { Stem } from "@studio/song-schema/stems";
import { useState } from "react";
import { m } from "../../paraglide/messages.js";
import type { DeckId, DeckLoads, DeckTempo } from "../deckVocabulary";
import type { DeskLayout } from "../deskLayout";
import type { DeckSet } from "../useDeckSet";
import type { Envelope } from "../waveform";
import { BpmFader } from "./BpmFader";
import { ChannelStrip, type StemPrep, StemStrip } from "./ChannelStrip";
import { CueButtons } from "./CueButtons";
import { LoopRow } from "./LoopRow";
import { Vinyl } from "./Vinyl";
import { Waveform } from "./Waveform";

/** A deck's waveform — `none` CARRIES ITS REASON, since an empty strip explains nothing on its own. */
export type Wave =
  | { k: "loading" }
  | { k: "ready"; env: Envelope }
  | { k: "none"; why: string };

/** Start or stop THIS deck — its own platter, which the one transport does not command. */
function DeckPlay({
  side,
  running,
  onToggle,
}: {
  side: "A" | "B";
  running: boolean;
  /** Absent when this deck holds no record — the button stays, disabled. See ../../docs/mix.md. */
  onToggle?: () => void;
}) {
  return (
    <Button
      size="sm"
      // Full width and the same height as KEY above it: the foot of the column is one block of two.
      className="h-12 w-full shrink-0 px-0"
      variant={running ? "default" : "secondary"}
      disabled={!onToggle}
      title={
        !onToggle
          ? m["deck.empty"]({ side })
          : running
            ? m["deck.stop"]({ side })
            : m["deck.start"]({ side })
      }
      onClick={onToggle}
      aria-pressed={running}
    >
      {running ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
    </Button>
  );
}

/** What a deck column needs to draw its loop row. Gathered so both decks say it once. */
interface LoopProps {
  beats: number | null;
  rolling: boolean;
  pending: boolean;
  step: number;
  can: boolean;
  onJump: (beats: number) => void;
  onIn: () => void;
  onOut: () => void;
  onLength: (beats: number) => void;
  onResize: (factor: number) => void;
  onRoll: (down: boolean) => void;
}

/** …read off the desk, so a third deck would not mean a third copy of these eleven lines. */
export function loopProps(decks: DeckSet, deckId: DeckId): LoopProps {
  const on = decks.loopOf(deckId);
  return {
    beats: on?.beats ?? null,
    rolling: !!on?.roll,
    pending: decks.pendingOf(deckId) !== null,
    step: decks.stepOf(deckId),
    can: decks.canLoop(deckId),
    onJump: (beats) => decks.beatJump(deckId, beats),
    onIn: () => decks.loopIn(deckId),
    onOut: () => decks.loopOut(deckId),
    onLength: (beats) => decks.setLoop(deckId, beats),
    onResize: (factor) => decks.resizeLoop(deckId, factor),
    // The roll takes the length the buttons last agreed on — there is no separate roll size.
    onRoll: (down) => decks.roll(deckId, decks.stepOf(deckId), down),
  };
}

export function DeckSide({
  side,
  layout,
  load,
  spinning,
  wave,
  tempo,
  driven,
  onNudge,
  onCommit,
  keylock,
  onKeylock,
  corrected,
  songKey,
  onHalve,
  onDouble,
  onPick,
  onDropSong,
  trim,
  trimLive,
  onTrim,
  eq,
  eqLive,
  onEq,
  filter,
  filterLive,
  onFilter,
  echo,
  echoLive,
  onEcho,
  stems,
  stemLive,
  stemsReady,
  stemPrep,
  onStem,
  cues,
  onCueJump,
  onCueSet,
  loop,
  loopSpan,
  onShove,
  needle,
  drawnNeedle,
  running,
  onToggleDeck,
  onScratch,
}: {
  side: "A" | "B";
  /** What fits in the height this deck has — the record's size, the waveform's, the title. */
  layout: DeskLayout;
  load: DeckLoads[DeckId];
  spinning: boolean;
  wave: Wave | undefined;
  /** What this deck plays at — already synced, so a slave shows the master's number. */
  tempo: DeckTempo | undefined;
  /** Driven by the other deck: the fader moves on its own and greys out. */
  driven: boolean;
  onNudge: (bpm: number) => void;
  onCommit: () => void;
  /** Whether this deck holds the pitch, and the switch for it — ../../docs/bpm.md. */
  keylock: boolean;
  onKeylock: () => void;
  /** Does PL8 hold a corrected tempo for this record, and the two gestures that write one? */
  corrected: boolean;
  /** …and its KEY as pl8 holds it, `C# minor` or "" — typed, never detected (../../docs/grid.md). */
  songKey: string;
  onHalve?: () => void;
  onDouble?: () => void;
  /** The record's middle was clicked — open the browser for this deck. */
  onPick: () => void;
  /** A playlist line was dropped on this deck, already read off the transfer — ../../docs/setList.md. */
  onDropSong: (drag: SongDrag) => void;
  /** The input gain in dB, at the HEAD of the strip — it reaches the record and its stems alike. */
  trim: number | undefined;
  trimLive: boolean;
  onTrim: (dB: number) => void;
  /** This deck's EQ knobs, in dB by band id, and whether they reach anything. */
  eq: Partial<Record<string, number>>;
  eqLive: boolean;
  onEq: (band: string, dB: number) => void;
  /** …and its filter, on the same strip but its own module. */
  filter: number | undefined;
  filterLive: boolean;
  onFilter: (value: number) => void;
  /** …and the one effect past it, 0..1. Unwired draws no knob rather than a dead one. */
  echo: number | undefined;
  echoLive: boolean;
  onEcho: (wet: number) => void;
  /** What this deck is REMOVING of each separated instrument, 0..1. Absent is none of it. */
  stems: Partial<Record<Stem, number>>;
  /** Whether the set wires stem cuts at all — false draws no column. */
  stemLive: boolean;
  /** …and whether the record on it has been separated, which is a different grey. */
  stemsReady: boolean;
  /** …and the separation running to make it so, when the set declared a chain. */
  stemPrep: StemPrep | undefined;
  onStem: (stem: Stem, cut: number) => void;
  /** This deck's eight cue slots, and the two gestures that move them. */
  cues: readonly (number | null)[];
  onCueJump: (slot: number) => void;
  onCueSet: (slot: number, sourceSeconds: number) => void;
  /** The loop section: what is running on this deck, and the six gestures that drive it — docs/loop.md. */
  loop: LoopProps;
  /** …and where it is, in source seconds, for the waveform to draw a band over. */
  loopSpan: { start: number; end: number } | null;
  /** Push this deck's record by `seconds`, signed — the waveform's drag and the nudge buttons both. */
  onShove: (seconds: number) => void;
  /** Where this deck's needle is in its RECORD — the platter's raw word, what a cue is written at. */
  needle: () => number;
  /** …and the same needle steered between frames, for what is drawn at 60 fps (docs/turntables/needleClock.md). */
  drawnNeedle: () => number;
  /** Is THIS deck turning? On a platter that is its own answer, not the transport's. */
  running: boolean;
  /** Start or stop it alone — absent on a separated deck, which has no platter to start. */
  onToggleDeck?: () => void;
  /** Drive the record by hand — absent for the same reason: a clip cannot be scratched. */
  onScratch?: (rate: number | null) => void;
}) {
  const fader = (
    // The tempo column, with THIS deck's transport at the foot of it — under KEY, docs/mix.md.
    <div className="flex h-full w-14 shrink-0 flex-col items-center gap-1">
      <BpmFader
        natural={tempo?.natural ?? 0}
        target={tempo?.target ?? 0}
        driven={driven}
        onChange={onNudge}
        onCommit={onCommit}
        keylock={keylock}
        onKeylock={onKeylock}
        corrected={corrected}
        songKey={songKey}
        onHalve={onHalve}
        onDouble={onDouble}
      />
      {/* Always drawn, greyed when the deck is empty — the rule `CueButtons` states, docs/cues.md. */}
      <DeckPlay side={side} running={running} onToggle={onToggleDeck} />
    </div>
  );

  const strip = (
    <ChannelStrip
      trim={trim}
      trimLive={trimLive}
      eq={eq}
      eqLive={eqLive}
      filter={filter}
      filterLive={filterLive}
      echo={echo}
      echoLive={echoLive}
      // The same measurement the column beside it uses — the strip has the same height to fit in.
      layout={layout.strip}
      onTrim={onTrim}
      onEq={onEq}
      onFilter={onFilter}
      onEcho={onEcho}
    />
  );

  const [over, setOver] = useState(false);
  return (
    // The WHOLE deck takes the drop, knobs included: aiming at the record's label is a gesture for a mouse at rest.
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop has no keyboard form; the vinyl's button is the one that has.
    <section
      className={`flex min-w-0 flex-1 gap-2 rounded-lg ${over ? "outline outline-2 outline-primary/70" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SONG_DRAG_TYPE)) return;
        // Both, and in this order: without preventDefault the browser refuses the drop without a word.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer LEFT the deck — a child's boundary fires this too.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        const drag = parseSongDrag(e.dataTransfer.getData(SONG_DRAG_TYPE));
        if (!drag) return;
        e.preventDefault();
        onDropSong(drag);
      }}
    >
      {/* Tempo on the OUTER edge and shaping on the INNER one, so the desk reads as a mirror. */}
      {side === "A" ? fader : strip}
      <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
        {/* The STEMS beside the record and to its LEFT, above the waveform — ../../docs/stems.md.
            `flex-1` and not `shrink-0`: this row takes whatever the block below leaves, and its own
            `items-center` then puts the record — and the stem knobs beside it — in the MIDDLE of
            that space rather than at the top of it. No `min-h-0`, so it can never shrink under the
            record it is holding. See ../../docs/deskLayout.md. */}
        <div className="flex flex-1 items-center justify-center gap-2">
          <StemStrip
            stems={stems}
            live={stemLive}
            ready={stemsReady}
            prep={stemPrep}
            layout={layout.strip}
            onStem={onStem}
          />
          {/* The record, only when the deck is tall enough to be worth one — ../../docs/deskLayout.md. */}
          {layout.vinyl > 0 ? (
            <Vinyl
              side={side}
              artist={load?.artist ?? null}
              title={load?.title ?? null}
              spinning={spinning && !!load}
              // How fast the FILE is playing: a record stretched to another tempo turns at that speed.
              ratio={
                tempo && tempo.natural > 0 && tempo.target > 0
                  ? tempo.target / tempo.natural
                  : 1
              }
              onPick={onPick}
              // The deck's own needle, steered — the wedge is looked at, never written down.
              at={drawnNeedle}
              length={tempo?.seconds ?? 0}
              markers={cues}
              size={layout.vinyl}
              onScratch={onScratch}
            />
          ) : null}
        </div>
        {/* The waveform and everything under it sit at the FOOT of the column: `deskLayout` caps the
            record, so a tall desk has slack, and left to fall after the title it pushed the strip
            the hands use away from the edge they reach for. `mt-auto` puts the slack ABOVE this
            block instead — see ../../docs/deskLayout.md. */}
        <div className="mt-auto flex w-full flex-col items-center gap-3">
          {/* Under the record, and ALWAYS drawn even with nothing loaded — ../../docs/deskLayout.md. */}
          <Waveform
            envelope={wave?.k === "ready" ? wave.env : null}
            // The same steered needle the record above reads.
            needle={drawnNeedle}
            loop={loopSpan}
            tempo={tempo}
            analysing={wave?.k === "loading"}
            problem={wave?.k === "none" ? wave.why : null}
            height={layout.waveform}
            // Draggable only with a record on and a tempo measured: `place` needs a ratio to convert by.
            onShove={load && tempo ? onShove : undefined}
          />
          {/* Edge to edge, nothing flanking them: eight cues are eight targets, and a target wants width. */}
          <CueButtons
            markers={cues}
            onJump={onCueJump}
            onSet={onCueSet}
            // The deck's OWN needle, read on the way down: no deck follows the transport any more.
            now={needle}
            disabled={!load}
          />
          {/* Under them, and greyed the same way: a loop is a length in BEATS, so it wants a grid. */}
          <LoopRow
            beats={loop.beats}
            rolling={loop.rolling}
            pending={loop.pending}
            step={loop.step}
            disabled={!load || !loop.can}
            onJump={loop.onJump}
            onIn={loop.onIn}
            onOut={loop.onOut}
            onLength={loop.onLength}
            onResize={loop.onResize}
            onRoll={loop.onRoll}
          />
          {/* What is loaded, in words: it earns its line only where the record's label is absent. */}
          {layout.title ? (
            <div className="w-full truncate text-center text-xs text-muted-foreground">
              {load ? load.title : m["deck.nothingLoaded"]()}
            </div>
          ) : null}
        </div>
      </div>
      {side === "B" ? fader : strip}
    </section>
  );
}
