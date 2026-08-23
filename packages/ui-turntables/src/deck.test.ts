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
  DOC_TEMPO,
  deckDoc,
  deckGain,
  gainToDb,
  levelId,
  METRONOME_TRACK,
  MIX_CENTRE,
  NO_LOADS,
  PITCH_RANGE,
  stemSource,
  syncedTempos,
  TEMPO_MODULE,
  TEMPO_PARAM,
  TEMPO_SOURCE_PARAM,
  TIMELINE_BASE,
  warpFor,
  withDecks,
} from "./deck";
import { playablePath } from "./service";

describe("where a stem's file is", () => {
  it("is `stems/` beside the record, whichever separator the machine uses", () => {
    // The path is the ENGINE machine's and this runs in a browser, so it is string work: a
    // Windows root normalised to POSIX here would be this app deciding something it does not own.
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

describe("turning a catalogue entry into something the engine can open", () => {
  it("joins the cache root, the entry's folder and the master file", () => {
    expect(playablePath("/home/flb/.studio/mediatek", entry())).toBe(
      "/home/flb/.studio/mediatek/songs/K7/rel/song/master.wav",
    );
  });

  it("keeps a Windows root's separator instead of normalising it", () => {
    // The service reports a NATIVE root while entry paths are POSIX, and the engine takes
    // either. Picking one shape here would be this app deciding something it does not own.
    expect(playablePath("C:\\Users\\flb\\.studio\\mediatek", entry())).toBe(
      "C:\\Users\\flb\\.studio\\mediatek\\songs/K7/rel/song\\master.wav",
    );
  });

  it("answers null for a folder catalogued with no audio", () => {
    // A real state, not a malformed entry: a mirror that failed halfway, or a folder made
    // by hand. The UI disables the deck buttons and says which of the two problems it is.
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
    // `a*(1-mix) + b*mix`. The two are not connected by code — one is a graph in the engine's
    // DSP host, the other a level on a track — so this test is the only thing holding them
    // together until playback goes through the compiler.
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
    // A range input cannot send these, but a future keyboard nudge or a stored value can,
    // and `1 - 1.5` is a NEGATIVE gain — which is a phase flip, not silence.
    expect(deckGain("deckA", 1.5)).toBe(0);
    expect(deckGain("deckB", -0.5)).toBe(0);
  });
});

describe("a gain as the strip's decibels", () => {
  it("puts unity at 0 dB, not at 1", () => {
    // The one mistake this conversion exists to prevent: a strip's Volume is -60..+6 dB, so
    // a surface sending 0..1 would look like it worked and be 6 dB of range wide.
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

describe("the deck's tempo is a MODULE, and the warp stands in for it", () => {
  it("names the médiathèque module the project actually puts on a deck", () => {
    // `example.m9`'s nodes extend exactly this. If the médiathèque renames the module,
    // this is the line that has to move with it — and the scaffold's own test pins the other
    // end, so the two cannot drift apart silently.
    expect(TEMPO_MODULE).toBe("@st0/audio/utility/tempo");
    expect(TEMPO_PARAM).toBe("Target BPM");
    expect(TEMPO_SOURCE_PARAM).toBe("Source BPM");
  });
});

describe("stretching a deck to a tempo", () => {
  const tempo = (over: Partial<DeckTempo> = {}): DeckTempo => ({
    natural: 120,
    seconds: 60, // 120 beats of music, at its own tempo
    target: 120,
    ...over,
  });

  it("does NOTHING when the target is the song's own tempo", () => {
    // An identity warp would put the stretch engine in the path to change nothing — CPU and
    // quality spent on a no-op.
    expect(warpFor(tempo())).toBeUndefined();
    expect(warpFor(tempo({ target: 120.0000001 }))).toBeUndefined();
  });

  it("refuses when there is no tempo, no target or no length", () => {
    expect(warpFor(tempo({ natural: 0 }))).toBeUndefined();
    expect(warpFor(tempo({ target: 0 }))).toBeUndefined();
    expect(warpFor(tempo({ seconds: 0 }))).toBeUndefined();
  });

  it("puts the whole file between two markers", () => {
    const w = warpFor(tempo({ target: 60 }));
    expect(w?.algorithm).toBe("elastique");
    expect(w?.markers[0]).toEqual([0, 0]);
    // The second marker's source time is the file's length, always — a linear stretch maps
    // the whole thing, and only the BEAT it lands on changes.
    expect(w?.markers[1][1]).toBe(60);
  });

  it("takes twice the beats at half the speed", () => {
    // 60 s at 120 bpm natural, played at 60 bpm: it lasts twice as long, so on a 120 bpm
    // timeline it occupies twice the beats.
    expect(warpFor(tempo({ target: 60 }))?.beats).toBeCloseTo(240);
    expect(warpFor(tempo({ target: 240 }))?.beats).toBeCloseTo(60);
  });

  it("lands a song on the beats the DOC tempo counts, not its own", () => {
    // The timeline is fixed at DOC_TEMPO and each deck reaches its target through its own
    // warp — that is what lets one document play two songs at two BPMs.
    const w = warpFor({ natural: 90, seconds: 60, target: DOC_TEMPO });
    // 60 s of 90 bpm played at 120 lasts 45 s, which is 90 beats at 120 bpm.
    expect(w?.beats).toBeCloseTo(90);
  });
});

describe("the BPM fader's ends", () => {
  it("is the MODULE's knob, 10 to 300", () => {
    // Not a range m9 invented: `@st0/audio/utility/tempo`'s ui.yaml declares a BPM knob
    // from 10 to 300, and the fader in Mix is that knob. A surface offering less would
    // quietly refuse values the module accepts.
    expect(BPM_RANGE).toEqual([10, 300]);
  });

  it("reaches any tempo a sync can ask for, so nothing has to be clamped", () => {
    // The old fader was ±16 % of the song and had to widen when a master drove it past its
    // own end. The module's range covers every real tempo, so that whole problem is gone.
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
    // The button says WHO LEADS. Pressing the right one makes B the master, so it keeps its
    // own 90 and A is driven to it — the mirror of the case above, not a repeat of it.
    const out = syncedTempos(both(), "deckB");
    expect(out.deckB?.target).toBe(90);
    expect(out.deckA?.target).toBe(90);
  });

  it("hands over the exact number, past what a real deck would bend", () => {
    // "Synced" means the same tempo. 90 -> 126 is a +40 % stretch, well past the ±16 % a
    // turntable offers — the readout warns in amber and the tempo still matches, because a
    // clamp would leave the two decks apart while the button claimed otherwise.
    const out = syncedTempos(both(), "deckA");
    expect(out.deckB?.target).toBe(126);
    expect(Math.abs(126 - 90)).toBeGreaterThan(90 * PITCH_RANGE);
  });

  it("changes nothing with no master", () => {
    expect(syncedTempos(both(), null)).toEqual(both());
  });

  it("drives nothing from a master with no tempo of its own", () => {
    // The engine found none. There is no number to sync to, and inventing one is the
    // confident lie this avoids.
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

  it("ALIGNS the beats too, not just the tempos", () => {
    // Sync is two facts. Two decks at the same BPM whose downbeats sit apart are not synced,
    // they are flamming — so the slave also gets the delay that closes the gap, and the
    // master gets none because it is what the other one is meeting.
    const t: DeckTempos = {
      deckA: { natural: 120, seconds: 60, target: 120, phase: 0.2 },
      deckB: { natural: 120, seconds: 60, target: 120, phase: 0.3 },
    };
    const out = syncedTempos(t, "deckA");
    expect(out.deckA?.align).toBeUndefined();
    // B's grid is 0.1 s late, so it waits 0.4 s for the master's next beat: 0.8 doc beats.
    expect(out.deckB?.align).toBeCloseTo(0.8, 6);
  });

  it("asks for no delay when the two grids already agree", () => {
    const t: DeckTempos = {
      deckA: { natural: 120, seconds: 60, target: 120, phase: 0.25 },
      deckB: { natural: 120, seconds: 60, target: 120, phase: 0.25 },
    };
    expect(syncedTempos(t, "deckA").deckB?.align).toBeCloseTo(0, 6);
  });

  it("aligns nothing it was told nothing about", () => {
    // A song with no onsets has no grid. It still gets the TEMPO — matching the speed is
    // worth having on its own — and a phase invented from nothing would move the record for
    // no reason. Both phases absent means both read as zero, which agree.
    const out = syncedTempos(both(), "deckA");
    expect(out.deckB?.target).toBe(126);
    expect(out.deckB?.align).toBeCloseTo(0, 6);
  });
});

describe("filling the decks into the COMPILED project", () => {
  /** A stand-in for what the compiler hands back: two decks, the crossfade on deck A with its
   *  baked graph and its side input, and deck A's tempo already applied by the chains. */
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
    // The whole point of playing the compiled document: the chains, the plugins and the DSP
    // are the project's. m9 fills in the one thing the project cannot say — which song.
    const before = compiled();
    const after = withDecks(before, loaded());
    // Everything the project declared, in its order — plus the one track m9 appends, which is
    // a desk control and not part of the set. See `metronomeTrack`.
    expect(after.tracks.map((t) => t.id)).toEqual([
      ...before.tracks.map((t) => t.id),
      METRONOME_TRACK,
    ]);
    expect(after.tracks[0].plugins).toEqual(before.tracks[0].plugins);
    expect(after.tempo).toBe(before.tempo);
  });

  it("puts each deck's song on its own track", () => {
    const doc = withDecks(compiled(), loaded());
    expect(doc.tracks[0].clips[0].source).toBe("/m/a.wav");
    expect(doc.tracks[1].clips[0].source).toBe("/m/b.wav");
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

  it("fills a stem lane from the file BESIDE the record", () => {
    const doc = withDecks(
      withStemLanes(),
      loaded({
        deckA: {
          path: "/m/song/master.wav",
          title: "A",
          artist: null,
          id: "songs/a",
          stems: true,
        },
      }),
    );
    const at = (id: string) => doc.tracks.find((t) => t.id === id);
    expect(at(stemLane("deckA", "bass"))?.clips[0].source).toBe(
      "/m/song/stems/bass.wav",
    );
    expect(at(stemLane("deckA", "vocals"))?.clips[0].source).toBe(
      "/m/song/stems/vocals.wav",
    );
    // The record itself is untouched: it is what the stems are subtracted FROM.
    expect(at("deckA")?.clips[0].source).toBe("/m/song/master.wav");
  });

  it("gives the record and its stems the SAME start and the same warp", () => {
    // The one thing that cannot be got wrong. A stem a sample off the record it is subtracted
    // from is not a quiet instrument, it is a comb filter — and nothing in the picture would
    // say so, because both clips are there and both play.
    const doc = withDecks(
      withStemLanes(),
      loaded({
        deckA: {
          path: "/m/song/master.wav",
          title: "A",
          artist: null,
          id: "songs/a",
          stems: true,
        },
      }),
      { deckA: { natural: 120, seconds: 60, target: 126 } },
    );
    const clips = ["deckA", ...STEMS.map((s) => stemLane("deckA", s))].map(
      (id) => doc.tracks.find((t) => t.id === id)?.clips[0],
    );
    for (const c of clips) {
      expect(c?.start).toBe(clips[0]?.start);
      expect(c?.length).toBe(clips[0]?.length);
      expect(c?.warp).toEqual(clips[0]?.warp);
    }
  });

  it("leaves the stem lanes EMPTY for a song nobody has separated", () => {
    // An empty lane subtracts nothing, so a record that was never prepared plays as itself.
    // The alternative — pointing four clips at files that are not there — would make putting
    // a record on depend on an hour of arithmetic nobody asked for.
    const doc = withDecks(withStemLanes(), loaded());
    for (const s of STEMS)
      expect(
        doc.tracks.find((t) => t.id === stemLane("deckA", s))?.clips,
      ).toEqual([]);
  });

  it("leaves an empty deck's clips alone rather than emptying them", () => {
    // A track the project gave clips of its own — not a deck — must come back untouched.
    const before = compiled();
    const after = withDecks(before, { ...NO_LOADS, deckA: loaded().deckA });
    expect(after.tracks[1].clips).toEqual(before.tracks[1].clips);
  });

  it("carries the tempo stretch onto the clip it fills in", () => {
    // The tempo module is `offline` and compiles to no plugin, so the stretch cannot be a
    // param — it stays a warp on the clip, which is the one thing that plays live.
    const doc = withDecks(compiled(), loaded(), {
      deckA: { natural: 120, seconds: 60, target: 60 },
    });
    expect(doc.tracks[0].clips[0].warp?.markers[1][0]).toBeCloseTo(240);
    expect(doc.tracks[1].clips[0].warp).toBeUndefined();
  });

  it("delays a clip by sync's alignment, and only when there is one", () => {
    // Where beat alignment actually lands: `start`, in document beats — on top of the headroom
    // every deck gets. Under one beat, so it costs the top of a deck nothing you would notice.
    const base = (TIMELINE_BASE * DOC_TEMPO) / 60;
    const doc = withDecks(compiled(), loaded(), {
      deckB: { natural: 120, seconds: 60, target: 120, align: 0.8 },
    });
    expect(doc.tracks[1].clips[0].start).toBeCloseTo(base + 0.8);
    // Deck A was handed no alignment: it sits on the base and nothing else.
    expect(doc.tracks[0].clips[0].start).toBeCloseTo(base);
  });

  it("starts every clip a HEADROOM in, so a slowed deck can slide earlier", () => {
    // The one reason the timeline does not begin where the music does. Slowing a deck means
    // its clip must start sooner than it does; from zero there is no sooner, and the engine
    // would take a negative start but then clamp every cue near the top of the song to it.
    const doc = withDecks(compiled(), loaded(), {
      deckA: { natural: 120, seconds: 60, target: 120, slip: -30 },
    });
    expect(doc.tracks[0].clips[0].start).toBeCloseTo(
      ((TIMELINE_BASE - 30) * DOC_TEMPO) / 60,
    );
    expect(doc.tracks[0].clips[0].start).toBeGreaterThan(0);
  });
});

describe("the decks' document", () => {
  it("carries BOTH decks, loaded or not, so a load is a diff and not a new track", () => {
    const empty = deckDoc(NO_LOADS);
    expect(empty.tracks.map((t) => t.id)).toEqual([...DECKS, METRONOME_TRACK]);
    // The ids are stable across every state — that is what lets the engine keep playing one
    // deck while the other is loaded underneath it.
    expect(deckDoc(loaded()).tracks.map((t) => t.id)).toEqual([
      ...DECKS,
      METRONOME_TRACK,
    ]);
  });

  it("keeps the metronome's track even when nothing is clicking", () => {
    // Not tidiness: `ChangeKind::TrackRemoved` is a stub in the engine, so a track dropped from
    // the document stays in the edit. A metronome that could not be switched off would be a
    // worse bug than the feature is a feature — so silence is an empty clip list, and clip
    // removal, which the engine really does implement, is what carries it.
    const off = deckDoc(loaded()).tracks.at(-1);
    expect(off?.id).toBe(METRONOME_TRACK);
    expect(off?.clips).toEqual([]);
    expect(off?.plugins.length).toBeGreaterThan(0);
  });

  it("names the tracks as the PROJECT's chains.yaml names them", () => {
    // Not cosmetic: when playback moves to the compiled project these ids stop being built
    // here and start coming from the file, and everything addressed by them has to survive.
    expect([...DECKS]).toEqual(["deckA", "deckB"]);
  });

  it("gives an empty deck a track with no clips rather than no track", () => {
    const doc = deckDoc({ ...NO_LOADS, deckA: loaded().deckA });
    expect(doc.tracks[0].clips).toHaveLength(1);
    expect(doc.tracks[1].clips).toEqual([]);
  });

  it("puts each deck's file on its own track", () => {
    const doc = deckDoc(loaded());
    expect(doc.tracks[0].clips[0].source).toBe("/m/a.wav");
    expect(doc.tracks[1].clips[0].source).toBe("/m/b.wav");
    expect(doc.tracks[0].clips[0].type).toBe("audio");
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
    // A strip is the end of a chain: a module added to a deck has to be heard before the
    // crossfader touches it, or the fade would apply in the middle of the signal path.
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
    expect(doc.tracks[0].plugins.map((p) => p.id)).toEqual([
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
    // A deck plays and never records; a made-up path is one the engine would eventually
    // try to write into. See emptyDoc.
    expect(deckDoc(loaded()).recordDir).toBe("");
  });

  it("carries no groups, so it can be sent unfolded", () => {
    // There is no PICTURE field to assert on: a ProjectDoc carries none, so the fold this
    // document skips is `withGroupMix` and nothing else.
    const doc = deckDoc(loaded());
    expect(doc.groups).toEqual([]);
  });
});
