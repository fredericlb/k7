import { parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { presetFileText } from "./presets";

describe("presetFileText", () => {
  it("writes k7x headed by its module and reads back as what it was given", () => {
    const preset = {
      engine: "vari-mu",
      base: "Pads/Bell Pad",
      params: { "Output Level": 0.8, on: 1 },
      rack: { kick: { note: 36, sample: "drums/kick.wav" } },
    };
    const text = presetFileText("@k7-core/audio/comp", preset);
    expect(text.startsWith("// preset for @k7-core/audio/comp\n")).toBe(true);
    expect(parse(text)).toEqual(preset);
  });

  it("refuses a preset its schema refuses", () => {
    expect(() =>
      presetFileText("@k7-core/audio/comp", { params: { x: "loud" } } as never),
    ).toThrow();
  });
});
