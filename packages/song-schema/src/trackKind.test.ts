import { describe, expect, it } from "vitest";
import {
  orderPosition,
  orderTracks,
  parseTrackName,
  reorderTracks,
  sortTracksByKind,
  TRACK_FAMILIES,
  TRACK_PREFIXES,
  trackKind,
  trackKindRank,
  trackLabel,
  trackPosition,
  trackPrefix,
} from "./trackKind";

describe("trackPrefix", () => {
  it("reads the two-letter code before the dot", () => {
    expect(trackPrefix("ge.lead")).toBe("ge");
    expect(trackPrefix("da.kit")).toBe("da");
  });

  it("is case-insensitive — the code is a code, not a spelling", () => {
    expect(trackPrefix("GE.Lead")).toBe("ge");
    expect(trackPrefix("Sx.Solo")).toBe("sx");
  });

  it("takes only the FIRST dot, so the rest of the name is free", () => {
    expect(trackPrefix("vo.lead.double")).toBe("vo");
  });

  it("gives nothing for a name with no usable prefix", () => {
    expect(trackPrefix("bass_3")).toBeNull(); // an unprefixed name
    expect(trackPrefix(".hidden")).toBeNull(); // a dot, but no code before it
    expect(trackPrefix("")).toBeNull();
  });

  it("gives nothing for an unknown code rather than guessing an instrument", () => {
    expect(trackPrefix("zz.what")).toBeNull();
    expect(trackPrefix("guitar.lead")).toBeNull(); // not a two-letter code
  });
});

describe("trackKind", () => {
  it("resolves the family and its human label", () => {
    expect(trackKind("ge.lead")).toEqual({
      prefix: "ge",
      family: "guitar",
      label: "guitare électrique",
    });
  });

  it("puts both drum codes, and all three bass codes, in one family", () => {
    expect(trackKind("da.kit")?.family).toBe("drums");
    expect(trackKind("ds.808")?.family).toBe("drums");
    for (const p of ["be", "ba", "bs"])
      expect(trackKind(`${p}.x`)?.family, p).toBe("bass");
  });

  it("names a family for every prefix", () => {
    for (const [p, [family]] of Object.entries(TRACK_PREFIXES))
      expect(TRACK_FAMILIES, p).toContain(family);
  });
});

describe("sortTracksByKind", () => {
  const order = (names: string[]) => sortTracksByKind(names, (n) => n);

  it("lays the families out in mix order", () => {
    expect(
      order([
        "sx.solo",
        "sy.pad",
        "pi.rhodes",
        "ga.rythm",
        "be.main",
        "da.kit",
        "ch.alto",
        "vo.lead",
      ]),
    ).toEqual([
      "vo.lead",
      "ch.alto",
      "da.kit",
      "be.main",
      "ga.rythm",
      "pi.rhodes",
      "sy.pad",
      "sx.solo",
    ]);
  });

  it("keeps unprefixed tracks last, in the order they came", () => {
    expect(order(["zoo", "vo.lead", "alpha", "da.kit"])).toEqual([
      "vo.lead",
      "da.kit",
      "zoo",
      "alpha",
    ]);
  });

  it("is stable inside a family — the author's own order survives", () => {
    // Three basses stay as filed; the sort groups families, it doesn't re-file them.
    expect(order(["be.z", "ba.a", "bs.m"])).toEqual(["be.z", "ba.a", "bs.m"]);
  });

  it("leaves a project that uses no prefixes exactly as it was", () => {
    const as_is = ["drums", "bass_3", "vox", "audio_6"];
    expect(order(as_is)).toEqual(as_is);
  });

  it("ranks an unknown code after every family", () => {
    expect(trackKindRank("zz.x")).toBeGreaterThan(trackKindRank("sx.x"));
  });
});

describe("parseTrackName (position · prefix · label)", () => {
  it("takes a name apart into its three optional parts", () => {
    expect(parseTrackName("3.ge.lead")).toEqual({
      position: 3,
      prefix: "ge",
      label: "lead",
    });
    expect(parseTrackName("ge.lead")).toEqual({
      position: null,
      prefix: "ge",
      label: "lead",
    });
    expect(parseTrackName("lead")).toEqual({
      position: null,
      prefix: null,
      label: "lead",
    });
  });

  it("lets a track pin its slot without declaring an instrument", () => {
    expect(parseTrackName("2.stems")).toEqual({
      position: 2,
      prefix: null,
      label: "stems",
    });
  });

  it("keeps the rest of the label intact, dots and all", () => {
    expect(parseTrackName("1.vo.lead.double").label).toBe("lead.double");
  });

  it("leaves a lone number alone — it's a label, not a position", () => {
    expect(parseTrackName("12")).toEqual({
      position: null,
      prefix: null,
      label: "12",
    });
  });

  it("keeps an unknown leading code in the label rather than guessing", () => {
    expect(parseTrackName("zz.what")).toEqual({
      position: null,
      prefix: null,
      label: "zz.what",
    });
  });

  it("still finds the instrument behind a position", () => {
    expect(trackKind("5.da.kit")?.family).toBe("drums");
    expect(trackPosition("5.da.kit")).toBe(5);
  });
});

describe("sortTracksByKind with pinned positions", () => {
  const order = (names: string[]) => sortTracksByKind(names, (n) => n);

  it("puts a numbered track in the slot it asks for", () => {
    // sx would sort last by family; the pin overrides that.
    expect(order(["vo.lead", "da.kit", "2.sx.solo"])).toEqual([
      "vo.lead",
      "2.sx.solo",
      "da.kit",
    ]);
  });

  it("fills the slots the pins left, in family order", () => {
    expect(order(["sy.pad", "1.zz.slate", "vo.lead", "4.ga.rythm"])).toEqual([
      "1.zz.slate",
      "vo.lead",
      "sy.pad",
      "4.ga.rythm",
    ]);
  });

  it("moves the loser of a duplicated number DOWN rather than dropping it", () => {
    const out = order(["2.a", "2.b", "vo.lead"]);
    expect(out).toEqual(["vo.lead", "2.a", "2.b"]);
    expect(out).toHaveLength(3);
  });

  it("lands a number past the end at the bottom", () => {
    expect(order(["99.outro", "vo.lead", "da.kit"])).toEqual([
      "vo.lead",
      "da.kit",
      "99.outro",
    ]);
  });

  it("treats 0 and 1 alike — both mean first", () => {
    expect(order(["vo.lead", "0.slate"])[0]).toBe("0.slate");
    expect(order(["vo.lead", "1.slate"])[0]).toBe("1.slate");
  });

  it("keeps every track, whatever the pins ask for", () => {
    const names = ["9.a", "9.b", "9.c", "1.d", "vo.e", "f"];
    expect(order(names).slice().sort()).toEqual(names.slice().sort());
  });
});

describe("trackLabel", () => {
  it("strips the metadata a view already shows another way", () => {
    expect(trackLabel("3.ge.lead")).toBe("lead"); // position + instrument
    expect(trackLabel("ge.lead")).toBe("lead"); // instrument
    expect(trackLabel("2.stems")).toBe("stems"); // position
    expect(trackLabel("lead")).toBe("lead"); // nothing to strip
  });

  it("keeps the rest of a dotted label whole", () => {
    expect(trackLabel("1.vo.lead.double")).toBe("lead.double");
  });

  it("keeps an unprefixed name as it is", () => {
    expect(trackLabel("bass_3")).toBe("bass_3");
    expect(trackLabel("zz.what")).toBe("zz.what"); // zz isn't an instrument code
  });

  it("falls back to the whole name rather than showing an empty row", () => {
    expect(trackLabel("ge.")).toBe("ge.");
  });
});

// A stated order must beat the names OUTRIGHT: two answers to "which lane is second" is the bug.
describe("orderTracks", () => {
  const names = ["ge.lead", "vo.main", "da.kit"];
  const order = (stated?: string[]) => orderTracks(names, (n) => n, stated);

  it("falls back to the families when the project states nothing", () => {
    expect(order()).toEqual(["vo.main", "da.kit", "ge.lead"]);
    expect(order([])).toEqual(["vo.main", "da.kit", "ge.lead"]);
  });

  it("obeys a stated order outright, family rank and all", () => {
    expect(order(["ge.lead", "da.kit", "vo.main"])).toEqual([
      "ge.lead",
      "da.kit",
      "vo.main",
    ]);
  });

  it("puts a lane the list forgot after the ones it names, in family order", () => {
    // Added by hand, or by an editor that did not know: an unlisted lane is still a lane.
    expect(order(["ge.lead"])).toEqual(["ge.lead", "vo.main", "da.kit"]);
  });

  it("ignores a name in the list that is no lane of this song", () => {
    expect(order(["gone", "da.kit"])).toEqual(["da.kit", "vo.main", "ge.lead"]);
  });
});

describe("reorderTracks", () => {
  const abc = ["a", "b", "c", "d"];

  it("moves one and states the whole list", () => {
    expect(reorderTracks(abc, "d", 1)).toEqual(["d", "a", "b", "c"]);
    expect(reorderTracks(abc, "a", 3)).toEqual(["b", "c", "a", "d"]);
  });

  it("clamps rather than refusing, both ends", () => {
    expect(reorderTracks(abc, "c", 0)).toEqual(["c", "a", "b", "d"]);
    expect(reorderTracks(abc, "a", 99)).toEqual(["b", "c", "d", "a"]);
  });

  it("is a no-op where the lane already is", () => {
    expect(reorderTracks(abc, "b", 2)).toEqual(abc);
  });

  it("adds a lane the list did not hold, rather than dropping the move", () => {
    expect(reorderTracks(abc, "e", 2)).toEqual(["a", "e", "b", "c", "d"]);
  });
});

describe("orderPosition", () => {
  const lanes = ["a", "b", "c"];

  it("reads a 1-based slot", () => {
    expect(orderPosition(lanes, "2")).toBe(2);
    expect(orderPosition(lanes, "99")).toBe(99); // clamping is reorderTracks's, not this one's
  });

  it("reads a LANE as the slot that lane holds", () => {
    expect(orderPosition(lanes, "c")).toBe(3);
  });

  it("answers null for a word that is neither", () => {
    expect(orderPosition(lanes, "top")).toBeNull();
    expect(orderPosition(lanes, "")).toBeNull();
  });
});
