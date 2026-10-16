// MixDeck.tsx — one deck of the desk: `DeckSide` bound to the set's verbs for ONE deck id, so the
// two columns MixView draws cannot wire a gesture to a different deck. See ../../docs/mix.md.

import type { SongDrag } from "@studio/mediatek/playlistItems";
import type { ComponentProps } from "react";
import type { DeckId } from "../deckVocabulary";
import type { DeckSet } from "../useDeckSet";
import { DeckSide, loopProps } from "./DeckSide";

type SideProps = ComponentProps<typeof DeckSide>;

export function MixDeck({
  id,
  decks,
  layout,
  wave,
  driven,
  canCorrect,
  onCorrect,
  onPick,
  onDropSong,
  stemPrep,
  loopSpan,
}: {
  id: DeckId;
  decks: DeckSet;
  layout: SideProps["layout"];
  wave: SideProps["wave"];
  /** The OTHER deck leads the sync, so this one's tempo follows it. */
  driven: boolean;
  /** Whether a tempo correction can be written — a library to write it to, and a natural tempo to halve. */
  canCorrect: boolean;
  onCorrect: (deckId: DeckId, bpm: number) => void;
  onPick: () => void;
  onDropSong: (drag: SongDrag) => void;
  stemPrep: SideProps["stemPrep"];
  loopSpan: SideProps["loopSpan"];
}) {
  const tempo = decks.tempos[id];
  const natural = tempo?.natural;
  return (
    <DeckSide
      side={id === "deckA" ? "A" : "B"}
      layout={layout}
      load={decks.loads[id]}
      spinning={decks.running(id)}
      wave={wave}
      tempo={tempo}
      driven={driven}
      onNudge={(bpm) => decks.nudge(id, bpm)}
      onCommit={decks.release}
      keylock={decks.keylock(id)}
      onKeylock={() => decks.toggleKeylock(id)}
      corrected={decks.gridOf(id).bpm !== undefined}
      songKey={decks.keyOf(id)}
      onHalve={
        canCorrect && natural ? () => onCorrect(id, natural / 2) : undefined
      }
      onDouble={
        canCorrect && natural ? () => onCorrect(id, natural * 2) : undefined
      }
      onPick={onPick}
      onDropSong={onDropSong}
      trim={decks.trimOf(id)}
      trimLive={decks.trimLive(id)}
      onTrim={(dB) => decks.turnTrim(id, dB)}
      eq={decks.eqOf(id)}
      eqLive={decks.eqLive(id)}
      onEq={(band, dB) => decks.turnEq(id, band, dB)}
      filter={decks.filterOf(id)}
      filterLive={decks.filterLive(id)}
      onFilter={(v) => decks.turnFilter(id, v)}
      echo={decks.echoOf(id)}
      echoLive={decks.echoLive(id)}
      onEcho={(v) => decks.turnEcho(id, v)}
      stems={decks.stemsOf(id)}
      stemLive={decks.stemLive(id)}
      stemsReady={decks.stemsReady(id)}
      stemPrep={stemPrep}
      onStem={(s, cut) => decks.turnStem(id, s, cut)}
      cues={decks.cuesOf(id)}
      onCueJump={(slot) => decks.jumpCue(id, slot)}
      onCueSet={(slot, at) => decks.setCue(id, slot, at)}
      onShove={(seconds) => decks.shove(id, seconds)}
      loop={loopProps(decks, id)}
      loopSpan={loopSpan}
      needle={decks.rawNeedle[id]}
      drawnNeedle={decks.drawnNeedle[id]}
      running={decks.running(id)}
      onToggleDeck={
        decks.canStartAlone(id) ? () => decks.toggleDeck(id) : undefined
      }
      onScratch={
        decks.canScratch(id) ? (rate) => decks.scratch(id, rate) : undefined
      }
    />
  );
}
