import { describe, expect, it } from "vitest";
import {
  type AudioDevice,
  bestPresent,
  desiredSwitch,
  menuSignature,
  reorder,
  signature,
} from "./audioPolicy.ts";

// The rules are stated in the test names: there is one list, and the first entry present wins.

const dev = (name: string, current: boolean): AudioDevice => ({
  name,
  deviceType: "CoreAudio",
  current,
});

describe("desiredSwitch", () => {
  it("stays put when already on the best-ranked device present", () => {
    const d = [dev("Scarlett", true), dev("Built-in", false)];
    expect(desiredSwitch(d, ["Scarlett", "Built-in"])).toBeNull();
  });

  it("returns to the better-ranked device when it reappears", () => {
    // The interface was replugged; the engine is still on the one below it.
    const d = [dev("Scarlett", false), dev("Built-in", true)];
    expect(desiredSwitch(d, ["Scarlett", "Built-in"])).toBe("Scarlett");
  });

  it("goes down the list when the one above is unplugged", () => {
    const d = [dev("Built-in", false), dev("HDMI", true)];
    expect(desiredSwitch(d, ["Scarlett", "Built-in"])).toBe("Built-in");
  });

  it("takes the FIRST present entry, not merely a present one", () => {
    // All three plugged in, engine on the last: the ranking is what decides, every time.
    const d = [
      dev("Scarlett", false),
      dev("Built-in", false),
      dev("HDMI", true),
    ];
    expect(desiredSwitch(d, ["Scarlett", "Built-in", "HDMI"])).toBe("Scarlett");
  });

  it("leaves an unranked device alone", () => {
    // Nothing the user ranked is here, so the engine keeps whatever it found: a device we did not choose beats none.
    expect(
      desiredSwitch([dev("HDMI", true)], ["Scarlett", "Built-in"]),
    ).toBeNull();
    expect(desiredSwitch([dev("HDMI", false)], [])).toBeNull();
  });

  it("ranks a device that is not current even when nothing is", () => {
    const d = [dev("Built-in", false), dev("HDMI", false)];
    expect(desiredSwitch(d, ["Built-in"])).toBe("Built-in");
  });

  it("empty device list is never acted on", () => {
    expect(desiredSwitch([], ["Scarlett"])).toBeNull();
  });
});

describe("bestPresent", () => {
  it("names the top-ranked device that is plugged in", () => {
    const d = [dev("Built-in", true)];
    expect(bestPresent(d, ["Scarlett", "Built-in"])).toBe("Built-in");
    expect(bestPresent(d, ["Scarlett"])).toBeNull();
  });
});

describe("reorder", () => {
  it("moves one name by one place", () => {
    expect(reorder(["A", "B", "C"], "C", -1)).toEqual(["A", "C", "B"]);
    expect(reorder(["A", "B", "C"], "A", 1)).toEqual(["B", "A", "C"]);
  });

  it("refuses to run off either end, rather than clamping silently to a no-op copy", () => {
    const rows = ["A", "B"];
    expect(reorder(rows, "A", -1)).toBe(rows);
    expect(reorder(rows, "B", 1)).toBe(rows);
    expect(reorder(rows, "Z", -1)).toBe(rows);
  });
});

describe("signature / menuSignature", () => {
  it("signature ignores ordering but not membership", () => {
    const a = [dev("A", false), dev("B", true)];
    const b = [dev("B", false), dev("A", false)];
    expect(signature(a)).toBe(signature(b));
    expect(signature(a)).not.toBe(signature([dev("A", false)]));
  });

  it("menuSignature tracks what the rows draw, the ORDER of the ranking included", () => {
    // `current` moves the mark and the ranking is rendered, so both have to move the signature or the screen shows stale rows.
    const base = [dev("A", false), dev("B", true)];
    const sig = menuSignature(base, ["A", "B"]);
    expect(
      menuSignature([dev("A", true), dev("B", false)], ["A", "B"]),
    ).not.toBe(sig);
    // The one the old two-field signature could not see: same names, different priority.
    expect(menuSignature(base, ["B", "A"])).not.toBe(sig);
    expect(menuSignature(base, ["A"])).not.toBe(sig);
    // …and, in the DEVICES half, it is order-insensitive as before.
    expect(menuSignature([dev("B", true), dev("A", false)], ["A", "B"])).toBe(
      sig,
    );
  });
});
