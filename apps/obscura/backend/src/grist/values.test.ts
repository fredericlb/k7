import { describe, expect, it } from "vitest";
import {
  asBool,
  asInt,
  buildAudioFilename,
  firstAttachmentId,
  optInt,
  parseChoiceList,
  parseEffects,
  parseRefList,
  resolveTrim,
  slugify,
} from "./values.ts";

describe("wire decoders", () => {
  it("parseRefList decodes ['L', …] preserving order", () => {
    expect(parseRefList(["L", 3, 1, 2])).toEqual([3, 1, 2]);
    expect(parseRefList(["L"])).toEqual([]);
    expect(parseRefList(["X", 1])).toEqual([]);
    expect(parseRefList(null)).toEqual([]);
    expect(parseRefList("nope")).toEqual([]);
  });

  it("parseChoiceList keeps non-empty strings", () => {
    expect(parseChoiceList(["L", "a", "", "b"])).toEqual(["a", "b"]);
    expect(parseChoiceList([])).toEqual([]);
  });

  it("firstAttachmentId returns the first id or null", () => {
    expect(firstAttachmentId(["L", 7, 8])).toBe(7);
    expect(firstAttachmentId(["L"])).toBeNull();
    expect(firstAttachmentId(null)).toBeNull();
  });

  it("asBool accepts Grist's bool/number/string encodings", () => {
    expect(asBool(true)).toBe(true);
    expect(asBool(1)).toBe(true);
    expect(asBool(0)).toBe(false);
    expect(asBool("true")).toBe(true);
    expect(asBool("1")).toBe(true);
    expect(asBool("no")).toBe(false);
    expect(asBool(null)).toBe(false);
  });

  it("optInt distinguishes unset from zero", () => {
    expect(optInt(null)).toBeNull();
    expect(optInt(undefined)).toBeNull();
    expect(optInt(0)).toBe(0);
    expect(optInt(3.9)).toBe(3);
  });

  it("asInt truncates floats", () => {
    expect(asInt(3.9)).toBe(3);
    expect(asInt("3")).toBe(0);
  });

  it("parseEffects strips the fx_ prefix and drops zeros", () => {
    expect(parseEffects({ fx_speed: 2, fx_pitch: 0, name: "x" })).toEqual({
      speed: 2,
    });
    expect(parseEffects({ fx_pitch: 0 })).toBeUndefined();
  });
});

describe("slugify", () => {
  it("folds accents and collapses separators (Go parity)", () => {
    expect(slugify("Édith Piaf")).toBe("edith_piaf");
    expect(slugify("  Dañs -- l'œuvre  ")).toBe("dans_l_oeuvre");
    expect(slugify("ABC123")).toBe("abc123");
    expect(slugify("!!!")).toBe("");
  });

  it("caps at 60 chars and trims trailing underscores", () => {
    const long = "a".repeat(59) + "_b";
    expect(slugify(long)).toBe("a".repeat(59));
  });
});

describe("trim + cache filenames", () => {
  it("resolveTrim defaults an open end to from+90s", () => {
    expect(resolveTrim(10, 0)).toEqual([10, 100]);
    expect(resolveTrim(10, 5)).toEqual([10, 100]);
    expect(resolveTrim(10, 20)).toEqual([10, 20]);
  });

  it("buildAudioFilename matches the Go layout", () => {
    expect(
      buildAudioFilename(
        7,
        "Édith Piaf",
        "La Vie en rose",
        1.5,
        31.5,
        "abc123.mp3",
      ),
    ).toBe("edith_piaf-la_vie_en_rose-s7-1500-31500-abc123.webm");
  });

  it("buildAudioFilename applies resolveTrim so plans match runtime", () => {
    expect(buildAudioFilename(1, "", "", 2, 0, "id.bin")).toBe(
      "s1-2000-92000-id.webm",
    );
  });
});
