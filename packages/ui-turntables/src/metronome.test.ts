// The click is m9's own track, not the engine's metronome, because the engine's clicks on the
// DOCUMENT's grid and the music's beat is somewhere else entirely. See ../docs/bpm.md.

import { describe, expect, it } from "vitest";
import { BEATS_PER_BAR } from "./beats";
import {
  type DeckLoads,
  type DeckTempo,
  type DeckTempos,
  DOC_TEMPO,
  METRONOME_TRACK,
  metronomeDeck,
  metronomeTrack,
  NO_LOADS,
  transportAt,
} from "./deck";

const song = (id: string) => ({
  id,
  title: id,
  artist: null,
  path: `/m/${id}.wav`,
});
const tempo = (over: Partial<DeckTempo> = {}): DeckTempo => ({
  natural: 128,
  seconds: 300,
  target: 128,
  phase: 0.37,
  ...over,
});

describe("whether the desk can offer a click at all", () => {
  it("follows the ONE deck when only one is loaded", () => {
    const loads: DeckLoads = { ...NO_LOADS, deckB: song("b") };
    expect(metronomeDeck(loads, { deckB: tempo() }, null)).toBe("deckB");
  });

  it("refuses two free decks, because there is no single beat to be on", () => {
    // Not a limitation to work around: two records at two tempos have two beats, and a click
    // on one of them is a click against the other. The button goes dark rather than pick.
    const loads: DeckLoads = { deckA: song("a"), deckB: song("b") };
    const tempos: DeckTempos = {
      deckA: tempo(),
      deckB: tempo({ natural: 174 }),
    };
    expect(metronomeDeck(loads, tempos, null)).toBeNull();
  });

  it("follows the MASTER once the two are synced", () => {
    const loads: DeckLoads = { deckA: song("a"), deckB: song("b") };
    const tempos: DeckTempos = {
      deckA: tempo(),
      deckB: tempo({ natural: 174 }),
    };
    expect(metronomeDeck(loads, tempos, "deckB")).toBe("deckB");
  });

  it("refuses a deck whose tempo is not known yet", () => {
    const loads: DeckLoads = { ...NO_LOADS, deckA: song("a") };
    expect(
      metronomeDeck(loads, { deckA: tempo({ natural: 0 }) }, null),
    ).toBeNull();
    expect(metronomeDeck(loads, {}, null)).toBeNull();
  });

  it("refuses a deck whose BEAT was never measured", () => {
    // A tempo says how often a beat happens, not which moment is one. `beats.ts` publishes no
    // phase it cannot defend, and a click on the wrong half of the beat is not a degraded
    // metronome — it is a wrong one, and you would beat-match to it.
    const loads: DeckLoads = { ...NO_LOADS, deckA: song("a") };
    expect(
      metronomeDeck(loads, { deckA: tempo({ phase: undefined }) }, null),
    ).toBeNull();
  });

  it("refuses when nothing is loaded", () => {
    expect(metronomeDeck(NO_LOADS, {}, null)).toBeNull();
    expect(metronomeDeck(NO_LOADS, { deckA: tempo() }, "deckA")).toBeNull();
  });
});

describe("the click track itself", () => {
  it("is in the document even when silent, because a track cannot be taken back", () => {
    // `ChangeKind::TrackRemoved` is a stub in the engine: a track dropped from the document
    // stays in the edit. A metronome that could not be switched off would be a worse bug than
    // the feature is a feature, so silence is an EMPTY CLIP LIST and clip removal is real.
    const off = metronomeTrack(tempo(), false);
    expect(off.id).toBe(METRONOME_TRACK);
    expect(off.clips).toEqual([]);
    expect(off.plugins.map((p) => p.type)).toContain("4osc");
  });

  it("clicks on the deck's OWN beat, not the document's", () => {
    // The whole reason this track exists. At 128 against a 120 document the two grids share no
    // beat but the first, so a click placed in document beats would drift a whole beat in
    // fifteen bars.
    const t = tempo({ target: 128 });
    const clip = metronomeTrack(t, true).clips[0];
    const inSeconds = (beats: number) => (beats * 60) / DOC_TEMPO;
    const gap = inSeconds(clip.notes[1].time - clip.notes[0].time);
    expect(gap).toBeCloseTo(60 / 128, 9);
    expect(gap).not.toBeCloseTo(60 / DOC_TEMPO, 4);
  });

  it("starts on the song's own downbeat, wherever the fader has left it", () => {
    // Through `transportAt`, so the stretch, sync's delay and the pitch fader's slip are all
    // already in it — the click follows the record rather than the timeline.
    const t = tempo({ target: 136, slip: -3.5, align: 0.8 });
    const clip = metronomeTrack(t, true).clips[0];
    expect((clip.start * 60) / DOC_TEMPO).toBeCloseTo(
      transportAt(t.phase ?? 0, t),
      9,
    );
  });

  it("is one looping bar rather than a note per beat", () => {
    // The clip is rebuilt on every step of a tempo drag, and a six-minute track is a thousand
    // notes to re-send and re-diff for a sound that repeats every four.
    const clip = metronomeTrack(tempo(), true).clips[0];
    expect(clip.notes).toHaveLength(BEATS_PER_BAR);
    expect(clip.loopEnd - clip.loopStart).toBeCloseTo(
      BEATS_PER_BAR * (DOC_TEMPO / 128),
      9,
    );
  });

  it("makes the bar's first beat sound different", () => {
    const notes = metronomeTrack(tempo(), true).clips[0].notes;
    expect(notes[0].key).toBeGreaterThan(notes[1].key);
    expect(notes.slice(1).every((n) => n.key === notes[1].key)).toBe(true);
  });

  it("stops when the record does", () => {
    // Length to the end of the song and no further: a click that outlived the music would be
    // the desk claiming a beat nothing is playing.
    const t = tempo({ target: 128 });
    const clip = metronomeTrack(t, true).clips[0];
    const endSeconds = ((clip.start + clip.length) * 60) / DOC_TEMPO;
    expect(endSeconds).toBeCloseTo(transportAt(t.seconds, t), 6);
  });

  it("is silent with no tempo to click at", () => {
    expect(metronomeTrack(undefined, true).clips).toEqual([]);
  });
});
