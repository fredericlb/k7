import { describe, expect, it } from "vitest";
import { isWaveMode, WAVE_MODES, WAVE_PRESS, waveCondition } from "./waveMode";

describe("the wave vocabulary", () => {
  it("recognises its own names and nothing else", () => {
    for (const m of WAVE_MODES) expect(isWaveMode(m)).toBe(true);
    expect(isWaveMode("standard ")).toBe(false);
    expect(isWaveMode("onset")).toBe(false);
    expect(isWaveMode("")).toBe(false);
  });

  it("opens on standard, which is the one that touches no mark", () => {
    expect(WAVE_MODES[0]).toBe("standard");
  });

  it("names one condition per mode", () => {
    expect(waveCondition("standard")).toBe("wave_standard");
    expect(waveCondition("onsets")).toBe("wave_onsets");
    expect(waveCondition("warp")).toBe("wave_warp");
  });

  it("gives no two modes the same condition", () => {
    const names = WAVE_MODES.map(waveCondition);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("WAVE_PRESS", () => {
  it("says what a press does in every mode — the whole point of naming them", () => {
    for (const m of WAVE_MODES) expect(WAVE_PRESS[m]).toBeTruthy();
    expect(new Set(Object.values(WAVE_PRESS)).size).toBe(WAVE_MODES.length);
  });

  it("names the way ON from standard, which is the mode you arrive in", () => {
    expect(WAVE_PRESS.standard).toMatch(/onsets/);
    expect(WAVE_PRESS.standard).toMatch(/warp/);
  });
});
