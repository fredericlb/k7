import { ModuleSchema } from "@studio/song/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  buildRackModuleYaml,
  cellsInNoteOrder,
  defaultSymbol,
  padNote,
  rackIssues,
} from "./rackBuilder";

// The rack builder's arithmetic. What is pinned hardest is the READING of the grid: bottom
// row first, left to right, then the row above — a drum machine's page — because the notes it
// assigns are addresses every sequencer row and every `sequence note` line will use for ever.

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
      rackIssues("drums", [pad("BD")], ["instruments/drums"]).join(" "),
    ).toContain("existe déjà");
  });

  it("refuses duplicate symbols and duplicate files — both are addresses", () => {
    expect(
      rackIssues("d", [pad("BD"), pad("BD", "bd2.wav", 37)]).join(" "),
    ).toContain("double");
    expect(
      rackIssues("d", [pad("BD", "x.wav"), pad("SN", "x.wav", 37)]).join(" "),
    ).toContain("même fichier");
  });

  it("refuses an empty grid", () => {
    expect(rackIssues("d", []).join(" ")).toContain("aucun sample");
  });
});

describe("buildRackModuleYaml", () => {
  const pads = [
    { symbol: "BD", fileName: "kick.wav", note: 36 },
    { symbol: "SN", fileName: "snare 01.wav", note: 37 },
  ];

  it("writes a module the schema accepts, symbols in the order given", () => {
    const text = buildRackModuleYaml("drums", pads);
    const doc = parse(text, { version: "1.2" });
    expect(ModuleSchema.safeParse(doc).success).toBe(true);
    expect(Object.keys(doc.rack.symbols)).toEqual(["BD", "SN"]);
    expect(doc.rack.symbols.BD).toEqual({ note: 36, clip: "kick.wav" });
    // A file name with a space survives the round trip — the stringifier owns the quoting.
    expect(doc.rack.symbols.SN.clip).toBe("snare 01.wav");
  });
});
