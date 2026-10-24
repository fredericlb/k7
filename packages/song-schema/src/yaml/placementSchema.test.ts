// One event schema for sound and shots: each vocabulary accepted, and the rules a shot carries.
import { describe, expect, it } from "vitest";
import { PlacementSchema } from "./placementSchema";

const ok = (p: unknown) => PlacementSchema.safeParse(p).success;
const issue = (p: unknown) =>
  PlacementSchema.safeParse(p).error?.issues[0]?.message ?? "";

describe("an event", () => {
  it("takes an audio event's words and a shot's", () => {
    expect(ok({ ref: "riff", start: "3:1", fadeIn: "0:1", loop: 2 })).toBe(
      true,
    );
    expect(
      ok({
        ref: "shot",
        start: 4,
        length: 3,
        from: 1.5,
        speed: 2,
        fadeIn: 0.5,
        fadeOut: { over: 1, with: "wipe" },
        animate: { x: [{ t: 0, v: 0 }] },
        silent: true,
      }),
    ).toBe(true);
  });

  it("takes no ref only as an activation, with nothing that needs a source", () => {
    expect(ok({ start: 2, length: 4 })).toBe(true);
    expect(issue({ start: 2, from: 1 })).toMatch(/ACTIVATION/);
  });

  it("refuses a backwards window and a reversed shot that runs out of source", () => {
    expect(issue({ ref: "a", from: 2, to: 1 })).toMatch(/greater than 'from'/);
    expect(issue({ ref: "a", from: 1, speed: -1, length: 3 })).toMatch(
      /runs out of source/,
    );
  });

  it("still refuses a key neither side has", () => {
    expect(ok({ ref: "a", source_from: 1 })).toBe(false);
  });
});
