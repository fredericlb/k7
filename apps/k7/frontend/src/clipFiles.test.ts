import { describe, expect, it } from "vitest";
import { candidateIds, declaredSource } from "./clipFiles";

describe("declaredSource", () => {
  it("reads the source a declaration names", () => {
    expect(declaredSource('source("clips/kick.wav")\n')).toBe("clips/kick.wav");
    expect(declaredSource("trim(1)\nsource('clips/a b.wav')\n")).toBe(
      "clips/a b.wav",
    );
    expect(declaredSource("gain(-3)\n")).toBeNull();
  });

  it("reads none in a declaration that does not parse", () => {
    expect(declaredSource('source("clips/kick.wav"\n')).toBeNull();
  });
});

describe("candidateIds", () => {
  it("tries the id itself, then numbered ones", () => {
    expect(candidateIds("kick", 3)).toEqual(["kick", "kick-2", "kick-3"]);
  });
});
