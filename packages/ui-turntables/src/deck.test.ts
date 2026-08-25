import { trackDoc, VOLUME_DB } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import type { MediatekEntry } from "@studio/mediatek/types";
import { STEMS, stemLane } from "@studio/song-schema/stems";
import { describe, expect, it } from "vitest";
import {
  BPM_RANGE,
  DECKS,
  type DeckLoads,
  type DeckTempo,
  type DeckTempos,
  deckDoc,
  deckGain,
  gainToDb,
  levelId,
  METRONOME_TRACK,
  MIX_CENTRE,
  NO_LOADS,
  PITCH_RANGE,
  PLATTER_TYPE,
  platterId,
  platterKey,
  plattersOf,
  SCRATCH_MS,
  scratchDelay,
  stemSource,
  syncedTempos,
  TEMPO_MODULE,
  TEMPO_PARAM,
  TEMPO_SOURCE_PARAM,
  withDecks,
} from "./deck";
import { playablePath } from "./service";

describe("where a stem's file is", () => {
  it("is `stems/` beside the record, whichever separator the machine uses", () => {
    // The path is the ENGINE machine's and this runs in a browser, so it is string work.
    expect(stemSource("/m/song/master.wav", "bass")).toBe(
      "/m/song/stems/bass.wav",
    );
    expect(stemSource("C:\\m\\song\\master.wav", "drums")).toBe(
      "C:\\m\\song\\stems/drums.wav",
    );
    // A bare file name has no folder to keep, and must not grow one.
    expect(stemSource("master.wav", "vocals")).toBe("stems/vocals.wav");
  });
});

const entry = (over: Partial<MediatekEntry> = {}): MediatekEntry => ({
  family: "songs",
  id: "songs/K7/rel/song",
  name: "Song",
  path: "songs/K7/rel/song",
  kind: "recorded",
  mtime: 0,
  meta: { catalogued: true, master: "master.wav" },
  ...over,
});

const loaded = (over: Partial<DeckLoads> = {}): DeckLoads => ({
  deckA: { path: "/m/a.wav", title: "A side", artist: "Artist", id: "songs/a" },
  deckB: { path: "/m/b.wav", title: "B side", artist: null, id: "songs/b" },
  ...over,
});

/** Tempos with KEYLOCK on. It no longer changes HOW a deck plays — only the platter's `Key`. */
const keyed = (over: DeckTempos = {}): DeckTempos => {
  const base: DeckTempos = {
    deckA: { natural: 0, seconds: 0, target: 0 },
    deckB: { natural: 0, seconds: 0, target: 0 },
    ...over,
  };
  return Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, v && { ...v, keylock: true }]),
  ) as DeckTempos;
};

/** A SEPARATED record on deck A — four platters sharing one position, not four clips. */
const separated = (over: Partial<DeckLoads> = {}): DeckLoads =>
  loaded({
    deckA: {
      path: "/m/song/original.mp3",
      title: "A",
      artist: null,
      id: "songs/a",
      stems: true,
    },
    ...over,
  });

describe("turning a catalogue entry into something the engine can open", () => {
  it("joins the cache root, the entry's folder and the master file", () => {
    expect(playablePath("/home/flb/.studio/mediatek", entry())).toBe(
      "/home/flb/.studio/mediatek/songs/K7/rel/song/master.wav",
    );
  });

  it("keeps a Windows root's separator instead of normalising it", () => {
    // The service reports a NATIVE root while entry paths are POSIX, and the engine takes either.
    expect(playablePath("C:\\Users\\flb\\.studio\\mediatek", entry())).toBe(
      "C:\\Users\\flb\\.studio\\mediatek\\songs/K7/rel/song\\master.wav",
    );
  });

  it("answers null for a folder catalogued with no audio", () => {
    // A real state, not a malformed entry: a mirror that failed halfway, or a folder made by hand.
    expect(
      playablePath("/root", entry({ meta: { catalogued: true } })),
    ).toBeNull();
  });

  it("answers null for an entry with no meta at all", () => {
    expect(playablePath("/root", entry({ meta: undefined }))).toBeNull();
  });
});

describe("the crossfade's law", () => {
  it("is the SAME line the crossfade module's jsdsp writes", () => {
    // `a*(1-mix) + b*mix` — nothing connects the two by code, so this test is what holds them together.
    for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
      expect(deckGain("deckA", mix)).toBeCloseTo(1 - mix);
      expect(deckGain("deckB", mix)).toBeCloseTo(mix);
    }
  });

  it("hands each end of the fader one deck alone", () => {
    expect(deckGain("deckA", 0)).toBe(1);
    expect(deckGain("deckB", 0)).toBe(0);
    expect(deckGain("deckA", 1)).toBe(0);
    expect(deckGain("deckB", 1)).toBe(1);
  });

  it("clamps a value from outside the fader rather than inverting it", () => {
    // `1 - 1.5` is a NEGATIVE gain — a phase flip, not silence — and a stored value can reach it.
    expect(deckGain("deckA", 1.5)).toBe(0);
    expect(deckGain("deckB", -0.5)).toBe(0);
  });
});

describe("a gain as the strip's decibels", () => {
  it("puts unity at 0 dB, not at 1", () => {
    // The mistake this prevents: a strip's Volume is -60..+6 dB, so 0..1 would look like it worked.
    expect(gainToDb(1)).toBe(VOLUME_DB.unity);
  });

  it("puts silence on the FLOOR, never at -Infinity", () => {
    expect(gainToDb(0)).toBe(VOLUME_DB.min);
    expect(Number.isFinite(gainToDb(0))).toBe(true);
  });

  it("halves to about -6 dB", () => {
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 1);
  });
});

describe("the deck's tempo is a MODULE, and the platter's rate realises it", () => {
  it("names the médiathèque module the project actually puts on a deck", () => {
    // `example.st0`'s nodes extend exactly this, and the scaffold's own test pins the other end.
    expect(TEMPO_MODULE).toBe("@st0/audio/utility/tempo");
    expect(TEMPO_PARAM).toBe("Target BPM");
    expect(TEMPO_SOURCE_PARAM).toBe("Source BPM");
  });
});

describe("the BPM fader's ends", () => {
  it("is the MODULE's knob, 10 to 300", () => {
    // Not a range the desk invented: `@st0/audio/utility/tempo`'s ui.yaml declares this knob.
    expect(BPM_RANGE).toEqual([10, 300]);
  });

  it("reaches any tempo a sync can ask for, so nothing has to be clamped", () => {
    // The module's range covers every real tempo, where a ±16 % fader would clamp a sync.
    const [lo, hi] = BPM_RANGE;
    for (const natural of [60, 90, 123.31, 174]) {
      expect(natural * (1 + PITCH_RANGE)).toBeLessThan(hi);
      expect(natural * (1 - PITCH_RANGE)).toBeGreaterThan(lo);
    }
  });
});

describe("sync hands one deck's tempo to the other", () => {
  const both = (): DeckTempos => ({
    deckA: { natural: 120, seconds: 60, target: 126 },
    deckB: { natural: 90, seconds: 60, target: 90 },
  });

  it("leaves the master alone and drives the slave", () => {
    const out = syncedTempos(both(), "deckA");
    expect(out.deckA?.target).toBe(126);
    expect(out.deckB?.target).toBe(126);
  });

  it("works the other way round, which is the second button", () => {
    // The button says WHO LEADS: pressing the right one keeps B's own 90 and drives A to it.
    const out = syncedTempos(both(), "deckB");
    expect(out.deckB?.target).toBe(90);
    expect(out.deckA?.target).toBe(90);
  });

  it("hands over the exact number, past what a real deck would bend", () => {
    // "Synced" means the same tempo: 90 -> 126 is a +40 % stretch, and a clamp would leave them apart.
    const out = syncedTempos(both(), "deckA");
    expect(out.deckB?.target).toBe(126);
    expect(Math.abs(126 - 90)).toBeGreaterThan(90 * PITCH_RANGE);
  });

  it("changes nothing with no master", () => {
    expect(syncedTempos(both(), null)).toEqual(both());
  });

  it("drives nothing from a master with no tempo of its own", () => {
    // The engine found none: there is no number to sync to, and inventing one is a confident lie.
    const t: DeckTempos = {
      deckA: { natural: 0, seconds: 60, target: 0 },
      deckB: { natural: 90, seconds: 60, target: 90 },
    };
    expect(syncedTempos(t, "deckA").deckB?.target).toBe(90);
  });

  it("leaves a slave that has no tempo of its own alone", () => {
    const t: DeckTempos = {
      deckA: { natural: 120, seconds: 60, target: 126 },
      deckB: { natural: 0, seconds: 60, target: 0 },
    };
    expect(syncedTempos(t, "deckA").deckB?.target).toBe(0);
  });

  it("matches the TEMPO and nothing else — the beats are put together by a seek", () => {
    // Sync's second half is `alignSeek`, on the needle. A platter has no clip to delay (../docs/bpm.md).
    const t: DeckTempos = {
      deckA: { natural: 120, seconds: 60, target: 120, phase: 0.2 },
      deckB: { natural: 120, seconds: 60, target: 120, phase: 0.3 },
    };
    const out = syncedTempos(t, "deckA");
    expect(out.deckB).toEqual({ ...t.deckB, target: 120 });
  });
});

describe("filling the decks into the COMPILED project", () => {
  /** A stand-in for what the compiler hands back: two decks, and the crossfade on deck A. */
  const compiled = (): ProjectDoc =>
    deckDoc(NO_LOADS, MIX_CENTRE, {
      deckA: [
        {
          name: "crossfade",
          category: "audio",
          plugin: { type: "internal", name: "DSP Graph" },
          enabled: true,
        },
      ],
    });

  it("keeps everything the project declared", () => {
    // The whole point of the compiled document: the desk fills in the one thing the project cannot say.
    const before = compiled();
    const after = withDecks(before, loaded());
    // Everything the project declared, in its order — plus the one track the desk appends for the click.
    expect(after.tracks.map((t) => t.id)).toEqual([
      ...before.tracks.map((t) => t.id),
      METRONOME_TRACK,
    ]);
    expect(after.tempo).toBe(before.tempo);
  });

  it("puts each deck's song on its own track", () => {
    // The record is the PLATTER's now, so "on its own track" is which plugin holds which file.
    const doc = withDecks(compiled(), loaded());
    const fileOn = (deck: string) =>
      doc.tracks.find((t) => t.id === deck)?.plugins[0].deckFile;
    expect(fileOn("deckA")).toBe("/m/a.wav");
    expect(fileOn("deckB")).toBe("/m/b.wav");
  });

  /** The compiled set as it is scaffolded now: each deck's lane, plus a lane per stem. */
  const withStemLanes = (): ProjectDoc => {
    const base = compiled();
    return {
      ...base,
      tracks: [
        ...base.tracks,
        ...DECKS.flatMap((d) =>
          STEMS.map((s) => trackDoc(stemLane(d, s), { mute: true })),
        ),
      ],
    };
  };

  it("puts a PLATTER on each stem lane, on the file beside the record", () => {
    const doc = withDecks(withStemLanes(), separated());
    const at = (id: string) => doc.tracks.find((t) => t.id === id)?.plugins[0];
    expect(at(stemLane("deckA", "bass"))?.deckFile).toBe(
      "/m/song/stems/bass.wav",
    );
    expect(at(stemLane("deckA", "vocals"))?.deckFile).toBe(
      "/m/song/stems/vocals.wav",
    );
    // …and the record's own lane holds NOTHING: the four parts ARE the record, so it would double it.
    const own = doc.tracks.find((t) => t.id === "deckA");
    expect(own?.clips).toEqual([]);
    expect(own?.plugins[0]?.type).not.toBe(PLATTER_TYPE);
  });

  it("drives the four parts as ONE record: same rate, same KEY", () => {
    // Four parts a few milliseconds or a few percent apart are a flam on every hit, and nothing
    // on screen would say so. They share a position too — `plattersOf` is what a gesture reaches.
    const doc = withDecks(
      withStemLanes(),
      separated(),
      keyed({ deckA: { natural: 120, seconds: 60, target: 126 } }),
      null,
      { deckA: true },
    );
    const parts = STEMS.map(
      (s) => doc.tracks.find((t) => t.id === stemLane("deckA", s))?.plugins[0],
    );
    for (const p of parts) {
      expect(p?.type).toBe(PLATTER_TYPE);
      expect(p?.params.Rate).toBe(parts[0]?.params.Rate);
      expect(p?.params.Key).toBe(parts[0]?.params.Key);
    }
    expect(parts[0]?.params.Rate).toBeCloseTo(126 / 120);
    expect(parts[0]?.params.Key).toBe(1);
    // …and every one of them is named, so `place` and `scratch` can reach all four.
    expect(plattersOf("deckA", separated().deckA)).toEqual(
      STEMS.map((s) => `${stemLane("deckA", s)}:platter`),
    );
    expect(plattersOf("deckA", loaded().deckA)).toEqual(["deckA:platter"]);
    expect(plattersOf("deckA", null)).toEqual([]);
  });

  it("leaves the stem lanes EMPTY for a song nobody has separated", () => {
    // An empty lane subtracts nothing, so a record that was never prepared plays as itself.
    const doc = withDecks(withStemLanes(), loaded());
    for (const s of STEMS)
      expect(
        doc.tracks.find((t) => t.id === stemLane("deckA", s))?.clips,
      ).toEqual([]);
    // And it plays the file itself, off its platter: there is no separation's decode to prefer.
    expect(doc.tracks.find((t) => t.id === "deckA")?.plugins[0].deckFile).toBe(
      loaded().deckA?.path,
    );
  });

  it("leaves an empty deck's clips alone rather than emptying them", () => {
    // A track the project gave clips of its own — not a deck — must come back untouched.
    const before = compiled();
    const after = withDecks(before, { ...NO_LOADS, deckA: loaded().deckA });
    expect(after.tracks[1].clips).toEqual(before.tracks[1].clips);
  });

  it("fills NO clip at all, on any lane", () => {
    // A stretched, aligned, slipped tempo used to produce one on every lane; a platter takes none.
    const doc = withDecks(withStemLanes(), separated(), {
      deckA: { natural: 120, seconds: 60, target: 126 },
    });
    for (const track of doc.tracks) expect(track.clips ?? []).toEqual([]);
  });
});

describe("every deck plays a platter, and a separated one plays four", () => {
  const compiled = (): ProjectDoc => deckDoc(NO_LOADS, MIX_CENTRE, {}, keyed());
  const platterOf = (doc: ProjectDoc, deck: string) =>
    doc.tracks
      .find((t) => t.id === deck)
      ?.plugins.find((p) => p.type === PLATTER_TYPE);

  it("hands the record to the PLUGIN and leaves the lane empty", () => {
    // The whole difference: the audio is the platter's, so there is nothing on the timeline to play.
    const doc = withDecks(compiled(), loaded());
    expect(doc.tracks[0].clips).toEqual([]);
    expect(platterOf(doc, "deckA")?.deckFile).toBe("/m/a.wav");
    expect(platterOf(doc, "deckB")?.deckFile).toBe("/m/b.wav");
  });

  it("puts it FIRST, so everything the project declared still shapes it", () => {
    const before = compiled();
    const after = withDecks(before, loaded());
    expect(after.tracks[0].plugins[0].type).toBe(PLATTER_TYPE);
    // …and the project's own chain follows it, in its order and untouched.
    expect(after.tracks[0].plugins.slice(1)).toEqual(before.tracks[0].plugins);
  });

  it("turns at the SPEED the tempo asks for, and not at all when stopped", () => {
    // Turning is PER DECK now: a platter carries its own transport — see docs/turntable.md.
    const at = (target: number, playing = true) =>
      platterOf(
        withDecks(
          compiled(),
          loaded(),
          { deckA: { natural: 120, seconds: 60, target } },
          null,
          { deckA: playing },
        ),
        "deckA",
      )?.params.Rate;
    // A 120 song asked to play at 60 runs at HALF speed. It read 2 — the STRETCH, which is the inverse.
    expect(at(60)).toBeCloseTo(0.5);
    expect(at(120)).toBeCloseTo(1);
    // …and the direction, which is what the inversion cost: asking for MORE tempo must speed it up.
    expect(at(140)).toBeGreaterThan(1);
    expect(at(60, false)).toBe(0);
  });

  it("does NOT turn because the transport rolls — a platter takes no orders from it", () => {
    // The regression this pins: PLAY moved the transport, the button lit, and every Rate stayed 0.
    const doc = withDecks(compiled(), loaded(), {}, null, {});
    expect(platterOf(doc, "deckA")?.params.Rate).toBe(0);
    expect(platterOf(doc, "deckB")?.params.Rate).toBe(0);
  });

  it("turns ONE deck without the other, which the transport could never do", () => {
    // The thing a single transport forbade: deck B rolls while deck A is stopped dead.
    const doc = withDecks(compiled(), loaded(), {}, null, { deckB: true });
    expect(platterOf(doc, "deckA")?.params.Rate).toBe(0);
    expect(platterOf(doc, "deckB")?.params.Rate).toBeGreaterThan(0);
  });

  it("STAYS on the platter when keylock comes on, and says so with a param", () => {
    // It used to hand the deck back to a stretched clip. The platter holds its own pitch now, so KEY
    // is one parameter and not a second way of playing — engine/moteur/docs/turntable.md.
    const doc = withDecks(compiled(), loaded(), keyed());
    expect(platterOf(doc, "deckA")?.params.Key).toBe(1);
    expect(doc.tracks[0].clips).toEqual([]);
    // …and off it, the same platter with the same record.
    const off = withDecks(compiled(), loaded());
    expect(platterOf(off, "deckA")?.params.Key).toBe(0);
  });

  it("gives the HAND the record whatever KEY says, which is what a scratch is", () => {
    // The join step 2 is about: a stretcher does not run backwards, and a scratch must change pitch
    // anyway. One rule, used by the document AND by the gesture — docs/scratch.md.
    const on: DeckTempo = {
      natural: 120,
      seconds: 60,
      target: 120,
      keylock: true,
    };
    const off: DeckTempo = { ...on, keylock: false };
    expect(platterKey(on, false)).toBe(1);
    expect(platterKey(on, true)).toBe(0);
    expect(platterKey(off, false)).toBe(0);
    expect(platterKey(off, true)).toBe(0);
    expect(platterKey(undefined, false)).toBe(0);
  });

  it("leaves a separated record's OWN lane silent, so the parts are not doubled", () => {
    const base = compiled();
    const doc = withDecks(
      {
        ...base,
        tracks: [...base.tracks, trackDoc(stemLane("deckA", "bass"))],
      },
      separated(),
    );
    expect(platterOf(doc, "deckA")).toBeUndefined();
    expect(platterOf(doc, stemLane("deckA", "bass"))?.deckFile).toBe(
      "/m/song/stems/bass.wav",
    );
  });
});

describe("the decks' document", () => {
  it("carries BOTH decks, loaded or not, so a load is a diff and not a new track", () => {
    const empty = deckDoc(NO_LOADS);
    expect(empty.tracks.map((t) => t.id)).toEqual([...DECKS, METRONOME_TRACK]);
    // The ids are stable across every state, so the engine keeps playing one deck while the other loads.
    expect(deckDoc(loaded()).tracks.map((t) => t.id)).toEqual([
      ...DECKS,
      METRONOME_TRACK,
    ]);
  });

  it("keeps the metronome's track even when nothing is clicking", () => {
    // Not tidiness: `ChangeKind::TrackRemoved` is a stub, so silence is an empty clip list (docs/metronome.md).
    const off = deckDoc(loaded()).tracks.at(-1);
    expect(off?.id).toBe(METRONOME_TRACK);
    expect(off?.clips).toEqual([]);
    expect(off?.plugins.length).toBeGreaterThan(0);
  });

  it("names the tracks as the PROJECT's chains.yaml names them", () => {
    // Not cosmetic: these ids come from the file once playback is the compiled project (docs/mix.md).
    expect([...DECKS]).toEqual(["deckA", "deckB"]);
  });

  it("gives an empty deck a track with no clips rather than no track", () => {
    const doc = deckDoc({ ...NO_LOADS, deckA: loaded().deckA }, MIX_CENTRE);
    // A loaded deck carries a PLATTER and no clip; an empty one carries neither, but still a track.
    expect(doc.tracks[0].plugins[0].type).toBe(PLATTER_TYPE);
    expect(doc.tracks[1].plugins[0].type).not.toBe(PLATTER_TYPE);
    expect(doc.tracks[1].clips).toEqual([]);
  });

  it("puts each deck's file on its own track", () => {
    const doc = deckDoc(loaded(), MIX_CENTRE);
    expect(doc.tracks[0].plugins[0].deckFile).toBe("/m/a.wav");
    expect(doc.tracks[1].plugins[0].deckFile).toBe("/m/b.wav");
  });

  it("ends each deck with the level the crossfader moves", () => {
    const doc = deckDoc(loaded(), MIX_CENTRE);
    for (const [i, deck] of DECKS.entries()) {
      const last = doc.tracks[i].plugins.at(-1);
      expect(last?.id).toBe(levelId(deck));
      // Centre: both decks half up, which is what makes a set audible before you touch it.
      expect(last?.params.Volume).toBeCloseTo(gainToDb(0.5), 5);
    }
  });

  it("puts the level LAST, after the deck's own effects", () => {
    // A strip is the end of a chain: a deck's own module is heard before the crossfader touches it.
    const doc = deckDoc(loaded(), MIX_CENTRE, {
      deckA: [
        {
          name: "filter",
          category: "audio",
          plugin: { type: "internal", name: "Filter" },
          enabled: true,
        },
      ],
    });
    // The PLATTER leads, being the source; then the deck's own module; then the level.
    expect(doc.tracks[0].plugins.map((p) => p.id)).toEqual([
      platterId("deckA"),
      "deckA:filter",
      levelId("deckA"),
    ]);
  });

  it("silences the far deck at each end of the fader", () => {
    const a = deckDoc(loaded(), 0);
    expect(a.tracks[1].plugins.at(-1)?.params.Volume).toBe(VOLUME_DB.min);
    const b = deckDoc(loaded(), 1);
    expect(b.tracks[0].plugins.at(-1)?.params.Volume).toBe(VOLUME_DB.min);
  });

  it("refuses to arm, by carrying no record directory", () => {
    // A deck plays and never records, and a made-up path is one the engine would write into.
    expect(deckDoc(loaded()).recordDir).toBe("");
  });

  it("carries no groups, so it can be sent unfolded", () => {
    // No PICTURE field to assert on: the fold this document skips is `withGroupMix` and nothing else.
    const doc = deckDoc(loaded());
    expect(doc.groups).toEqual([]);
  });
});

describe("how often a scratch reaches the engine", () => {
  it("lets the first move through", () => {
    // The leading edge matters: a gesture that starts a frame late reads as a stuck record.
    expect(scratchDelay(999, 1.5)).toBe(0);
  });

  it("holds one that comes too soon, by what is LEFT of the interval", () => {
    // Not a fixed wait: the hand keeps its cadence instead of drifting by a frame per move.
    expect(scratchDelay(0, 1.5, 16)).toBe(16);
    expect(scratchDelay(6, 1.5, 16)).toBe(10);
    expect(scratchDelay(16, 1.5, 16)).toBe(0);
  });

  it("never holds the RELEASE, however soon it comes", () => {
    // Letting go hands the record back; delayed by even one frame it would keep scratching after the hand left.
    expect(scratchDelay(0, null, 16)).toBe(0);
    expect(scratchDelay(1, null)).toBe(0);
  });

  it("is far under what a pointer produces, and far over what an ear needs", () => {
    // A 1000 Hz mouse sends one per millisecond; this keeps about sixteen of every thousand.
    expect(SCRATCH_MS).toBeGreaterThan(8);
    expect(SCRATCH_MS).toBeLessThanOrEqual(20);
  });
});
