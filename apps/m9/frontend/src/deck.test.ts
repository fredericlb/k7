import { VOLUME_DB } from "@studio/engine-protocol/build";
import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import {
  DECKS,
  type DeckLoads,
  deckDoc,
  deckGain,
  gainToDb,
  levelId,
  MIX_CENTRE,
  NO_LOADS,
} from "./deck";
import { playablePath } from "./service";

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

describe("the decks' document", () => {
  it("carries BOTH decks, loaded or not, so a load is a diff and not a new track", () => {
    const empty = deckDoc(NO_LOADS);
    expect(empty.tracks.map((t) => t.id)).toEqual([...DECKS]);
    // The ids are stable across every state — that is what lets the engine keep playing one
    // deck while the other is loaded underneath it.
    expect(deckDoc(loaded()).tracks.map((t) => t.id)).toEqual([...DECKS]);
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

  it("carries no video and no groups, so it can be sent unfolded", () => {
    const doc = deckDoc(loaded());
    expect(doc.groups).toEqual([]);
    expect(doc.video).toBe(false);
  });
});
