import { ModuleSchema } from "@studio/song-schema/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  buildKitNodeYaml,
  cellsInNoteOrder,
  defaultSymbol,
  kitUploadDir,
  padNote,
  RACK_MODULE_REF,
  RACK_MODULE_YAML,
  rackIssues,
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

  it("is a node of the sampler, one tap per pad naming its sample in the PROJECT's samples/", () => {
    const text = buildKitNodeYaml("drums", pads, "project");
    const doc = parse(text, { version: "1.2" });
    expect(ModuleSchema.safeParse(doc).success).toBe(true);
    expect(doc.extends).toBe(RACK_MODULE_REF);
    expect(Object.keys(doc.rack.symbols)).toEqual(["BD", "SN"]);
    expect(doc.rack.symbols.BD).toEqual({
      note: 36,
      sample: "@project/drums/kick.wav",
    });
    // A file name with a space survives the round trip — the stringifier owns the quoting.
    expect(doc.rack.symbols.SN.sample).toBe("@project/drums/snare 01.wav");
    // …one tap to a line, the way a drum map is read.
    expect(text).toMatch(/^ {4}BD: \{ note: 36, sample: /m);
  });

  it("names a LIBRARY's samples when the kit's sounds go there", () => {
    const doc = parse(buildKitNodeYaml("drums", pads, { library: "st0" }), {
      version: "1.2",
    });
    expect(doc.rack.symbols.BD.sample).toBe("@st0/drums/kick.wav");
  });

  it("uploads into the samples/ that name points at", () => {
    expect(kitUploadDir("project", "drums", "songs/first.st0")).toBe(
      "songs/first.st0/samples/drums",
    );
    expect(kitUploadDir("project", "drums", ".")).toBe("samples/drums");
    expect(kitUploadDir({ library: "st0" }, "drums", "songs/first.st0")).toBe(
      "_libraries/st0/samples/drums",
    );
  });

  it("writes a sampler that is a rack and carries no sound", () => {
    const doc = parse(RACK_MODULE_YAML, { version: "1.2" });
    expect(doc).toEqual({ type: "rack" });
  });
});
