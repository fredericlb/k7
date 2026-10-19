import { parse } from "@studio/k7x/document";
import { ModuleSchema } from "@studio/song-schema/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import {
  buildKitNode,
  cellsInNoteOrder,
  defaultSymbol,
  kitUploadDir,
  padNote,
  rackIssues,
  rackModuleRef,
} from "./rackBuilder";

// The rack builder's arithmetic, and hardest the READING of the grid: the notes it assigns are addresses every `sequence note` line will use.

describe("padNote — the drum-machine reading", () => {
  it("starts at 36 bottom-left and ends at 51 top-right", () => {
    expect(padNote(3, 0)).toBe(36); // bottom-left
    expect(padNote(3, 3)).toBe(39); // bottom-right
    expect(padNote(2, 0)).toBe(40); // one row up, back to the left
    expect(padNote(0, 0)).toBe(48); // top-left
    expect(padNote(0, 3)).toBe(51); // top-right
  });

  it("walks every cell once, in note order", () => {
    const notes = cellsInNoteOrder().map(({ row, col }) => padNote(row, col));
    expect(notes).toEqual(Array.from({ length: 16 }, (_, i) => 36 + i));
  });
});

describe("defaultSymbol", () => {
  it("upper-cases the stem and squeezes it to the identifier charset", () => {
    expect(defaultSymbol("kick.wav")).toBe("KICK");
    expect(defaultSymbol("Snare Tight 01.wav")).toBe("SNARE_TIGHT_01");
    expect(defaultSymbol("hi-hat.wav")).toBe("HI-HAT");
  });

  it("never answers an empty symbol", () => {
    expect(defaultSymbol("...wav")).toBe("PAD");
  });
});

describe("rackIssues", () => {
  const pad = (symbol: string, fileName = `${symbol}.wav`, note = 36) => ({
    symbol,
    fileName,
    note,
  });

  it("lets a clean rack through", () => {
    expect(rackIssues("drums", [pad("BD"), pad("SN", "sn.wav", 37)])).toEqual(
      [],
    );
  });

  it("refuses a name that cannot be a folder, and one already taken", () => {
    expect(rackIssues("", [pad("BD")]).length).toBeGreaterThan(0);
    expect(rackIssues("a b", [pad("BD")]).length).toBeGreaterThan(0);
    expect(
      // The kit is a NODE, so the name it must not clash with is a node's.
      rackIssues("drums", [pad("BD")], ["drums"]).join(" "),
    ).toContain("exists already");
  });

  it("refuses duplicate symbols and duplicate files — both are addresses", () => {
    expect(
      rackIssues("d", [pad("BD"), pad("BD", "bd2.wav", 37)]).join(" "),
    ).toContain("duplicate symbol");
    expect(
      rackIssues("d", [pad("BD", "x.wav"), pad("SN", "x.wav", 37)]).join(" "),
    ).toContain("same file");
  });

  it("refuses an empty grid", () => {
    expect(rackIssues("d", []).join(" ")).toContain("no sample");
  });
});

describe("the kit the builder writes", () => {
  const pads = [
    { symbol: "BD", fileName: "kick.wav", note: 36 },
    { symbol: "SN", fileName: "snare 01.wav", note: 37 },
  ];

  const RACK = "@k7-core/instruments/k7-rack";

  it("is a node of the sampler, one tap per pad naming its sample in the PROJECT's samples/", () => {
    const text = buildKitNode("drums", pads, "project", RACK);
    const doc = parse(text) as {
      extends: string;
      engine: string;
      rack: { symbols: Record<string, { note: number; sample: string }> };
    };
    expect(ModuleSchema.safeParse(doc).success).toBe(true);
    expect(doc.extends).toBe(RACK);
    // The sampler ENGINE, said outright: the module's default is an SFZ kit, which would ignore the taps.
    expect(doc.engine).toBe("samples");
    expect(Object.keys(doc.rack.symbols)).toEqual(["BD", "SN"]);
    expect(doc.rack.symbols.BD).toEqual({
      note: 36,
      sample: "@project/drums/kick.wav",
    });
    // A file name with a space survives the round trip — the printer owns the quoting.
    expect(doc.rack.symbols.SN.sample).toBe("@project/drums/snare 01.wav");
    // …one tap to a line, the way a drum map is read, under the header that says what made it.
    expect(text).toMatch(/^ {4}BD: \{ note: 36, sample: /m);
    expect(text.startsWith("// drums — a kit")).toBe(true);
  });

  it("names a LIBRARY's samples when the kit's sounds go there", () => {
    const doc = parse(
      buildKitNode("drums", pads, { library: "k7-core" }, RACK),
    ) as { rack: { symbols: Record<string, { sample: string }> } };
    expect(doc.rack.symbols.BD.sample).toBe("@k7-core/drums/kick.wav");
  });

  it("uploads into the samples/ that name points at", () => {
    expect(kitUploadDir("project", "drums", "songs/first.k7")).toBe(
      "songs/first.k7/samples/drums",
    );
    expect(kitUploadDir("project", "drums", ".")).toBe("samples/drums");
    expect(
      kitUploadDir({ library: "k7-core" }, "drums", "songs/first.k7"),
    ).toBe("_libraries/k7-core/samples/drums");
  });
});

describe("the sampler a kit extends", () => {
  it("is a LIBRARY's k7-rack, @k7-core's first", () => {
    expect(
      rackModuleRef([
        "@drums/instruments/k7-rack",
        "@k7-core/instruments/k7-rack",
      ]),
    ).toBe("@k7-core/instruments/k7-rack");
    expect(rackModuleRef(["@drums/instruments/k7-rack"])).toBe(
      "@drums/instruments/k7-rack",
    );
  });

  it("is never a workspace copy, and is null when no library holds one", () => {
    expect(rackModuleRef(["@workspace/instruments/k7-rack"])).toBeNull();
    expect(rackModuleRef(["@k7-core/instruments/rack"])).toBeNull();
    // …which is said before any upload runs, rather than failing after sixteen of them.
    expect(
      rackIssues(
        "d",
        [{ symbol: "BD", fileName: "bd.wav", note: 36 }],
        [],
        false,
      ).join(" "),
    ).toContain("k7-rack");
  });
});
