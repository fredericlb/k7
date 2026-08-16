// The measuring cold pass. The failure worth guarding is not "the number is wrong" — the engine
// measures it — but WHERE the number is written: a chain resolved once and rendered over several
// sources must not carry the first file's peak into the second. That one is silent, lands only on
// the files after the first, and survives a demo.

import { pluginDoc } from "@studio/engine-protocol/build";
import { describe, expect, it } from "vitest";
import { needsPeak, PEAK_PARAM, withMeasuredPeak } from "./peakPass";

const normalizer = (over: Record<string, number> = {}) =>
  pluginDoc({
    id: "n",
    type: "DSP Graph",
    name: "normalize",
    params: { Target: -1, [PEAK_PARAM]: 0, ...over },
  });
const reverb = () =>
  pluginDoc({
    id: "r",
    type: "internal",
    name: "Reverb",
    params: { Mix: 0.3 },
  });

describe("needsPeak", () => {
  it("is true only when something declares the param", () => {
    expect(needsPeak([normalizer()])).toBe(true);
    expect(needsPeak([reverb()])).toBe(false);
    expect(needsPeak([])).toBe(false);
  });

  it("finds one behind other modules — a normaliser need not be first", () => {
    expect(needsPeak([reverb(), normalizer(), reverb()])).toBe(true);
  });
});

describe("withMeasuredPeak", () => {
  it("writes the measurement in", () => {
    const [p] = withMeasuredPeak([normalizer()], -12.5);
    expect(p.params[PEAK_PARAM]).toBe(-12.5);
  });

  it("does NOT mutate the chain it was given — the next file has its own peak", () => {
    // The whole reason this returns a copy. `track process` resolves one chain and renders it over
    // every file a lane's clips play; writing back would hand file two file one's gain.
    const chain = [normalizer()];
    withMeasuredPeak(chain, -12.5);
    expect(chain[0].params[PEAK_PARAM]).toBe(0);
    // …and twice over two peaks gives two answers, not one.
    expect(withMeasuredPeak(chain, -3)[0].params[PEAK_PARAM]).toBe(-3);
    expect(withMeasuredPeak(chain, -20)[0].params[PEAK_PARAM]).toBe(-20);
  });

  it("leaves every other param and every other module alone", () => {
    const out = withMeasuredPeak([reverb(), normalizer()], -6);
    expect(out[0].params).toEqual({ Mix: 0.3 });
    expect(out[1].params.Target).toBe(-1); // the AUTHORED half is untouched
  });

  it("keeps the plugin's identity, so the render still knows what to load", () => {
    const [p] = withMeasuredPeak([normalizer()], -6);
    expect(p.id).toBe("n");
    expect(p.name).toBe("normalize");
    expect(p.type).toBe("DSP Graph");
  });
});
