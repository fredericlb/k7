// Moving a material's window down onto every placement — NOTHING SOUNDS DIFFERENT; docs/windowDescend.md.

import { describe, expect, it } from "vitest";
import {
  descendWindows,
  edgeBeats,
  type MaterialWindow,
  materialWindow,
  narrowest,
  stripMaterialWindow,
} from "./windowDescend";

const G = { tempo: 110, num: 4, den: 4 };
const clip = (w: Partial<MaterialWindow>): MaterialWindow => ({
  kind: "clip",
  ...w,
});
const seq = (w: Partial<MaterialWindow>): MaterialWindow => ({
  kind: "sequence",
  ...w,
});

describe("reading an edge", () => {
  it("takes a clip's bare number as SECONDS, converted at the tempo", () => {
    expect(edgeBeats(1.32, "clip", G)).toBeCloseTo((1.32 * 110) / 60, 9);
  });

  it("takes a timecode as a position, either kind", () => {
    expect(edgeBeats("3:1", "clip", G)).toBe(8);
    expect(edgeBeats("3:1", "sequence", G)).toBe(8);
  });

  it("refuses a bare number on a SEQUENCE — it has no seconds axis", () => {
    // The confusion this migration ends: the same spelling would mean beats one folder over.
    expect(edgeBeats(4, "sequence", G)).toBeNull();
  });

  it("answers null for a half-typed timecode rather than guessing", () => {
    expect(edgeBeats("3:", "clip", G)).toBeNull();
  });
});

describe("reading a material file", () => {
  it("finds a window, whichever spelling", () => {
    expect(
      materialWindow("source: a.wav\nfrom: 1.32\nto: 4.36\n", "clip"),
    ).toEqual({ kind: "clip", from: 1.32, to: 4.36 });
    expect(materialWindow('source: a.wav\nto: "3:1"\n', "clip")).toEqual({
      kind: "clip",
      from: undefined,
      to: "3:1",
    });
  });

  it("answers null when there is nothing to move", () => {
    expect(materialWindow("source: a.wav\n", "clip")).toBeNull();
  });

  it("ignores a `from` nested under another key", () => {
    // Only a TOP-LEVEL edge is the material's own; a warp's markers live indented too.
    expect(
      materialWindow("source: a.wav\nwarp:\n  from: 9\n  to: 10\n", "clip"),
    ).toBeNull();
  });
});

describe("stripping it", () => {
  it("removes both words and leaves the rest alone", () => {
    const out = stripMaterialWindow(
      "# Rendered by `event consolidate`.\nsource: clips/r.wav\nfrom: 1.32\nto: 4.36\n",
    );
    expect(out).toContain("source: clips/r.wav");
    expect(out).toContain("Rendered by");
    expect(out).not.toContain("from:");
    expect(out).not.toContain("to:");
  });

  it("leaves a file that states none byte-identical", () => {
    const text = "source: clips/r.wav\nwarp:\n  algorithm: slice\n";
    expect(stripMaterialWindow(text)).toBe(text);
  });
});

describe("the intersection, resolved once", () => {
  it("keeps the larger `from` and the smaller `to`", () => {
    const w = narrowest(clip({ from: 1, to: 9 }), { from: 3, to: 5 }, G);
    expect(w).toMatchObject({ from: 3, to: 5, intersected: true });
    const v = narrowest(clip({ from: 4, to: 4.5 }), { from: 1, to: 9 }, G);
    expect(v).toMatchObject({ from: 4, to: 4.5 });
  });

  it("keeps the WINNING edge's own spelling, across the two", () => {
    // 3:1 is 8 beats = 4.3636 s at 110; 2 s is smaller, so the number wins and stays a number.
    const w = narrowest(clip({ to: "3:1" }), { to: 2 }, G);
    expect(w.to).toBe(2);
    // …and the other way round, the timecode survives as a timecode.
    const v = narrowest(clip({ to: "3:1" }), { to: 9 }, G);
    expect(v.to).toBe("3:1");
  });

  it("takes the one side that states an edge, and says it did not intersect", () => {
    expect(narrowest(clip({ from: 1.32 }), {}, G)).toEqual({
      from: 1.32,
      intersected: false,
    });
    expect(narrowest(clip({}), { to: 4 }, G)).toEqual({
      to: 4,
      intersected: false,
    });
  });

  it("leaves an absent pair absent — which now means the whole file", () => {
    expect(narrowest(clip({}), {}, G)).toEqual({ intersected: false });
  });
});

const LANE = `extends: "@meta/track"
events:
  - { ref: kick, start: "1:1" }
  - { ref: snare, start: "2:1" }
alternatives:
  - events:
      - { ref: kick, start: "5:1" }
`;

const WINDOWS: Record<string, MaterialWindow> = {
  kick: clip({ from: 1.32, to: 4.36 }),
};

describe("the descent, over a whole lane file", () => {
  const run = (text = LANE, w = WINDOWS) =>
    descendWindows(text, (r) => w[r], G);

  it("reaches the playing events and every alternative's own", () => {
    // Two placements of `kick`, in two different lists. Missing one is the failure found last.
    const out = run();
    expect(out.wrote).toBe(2);
    expect(out.text.match(/from: 1\.32/g)).toHaveLength(2);
  });

  it("leaves a placement whose material states nothing untouched", () => {
    const out = run();
    expect(out.text).toMatch(/ref: snare, start: "2:1" \}/);
  });

  it("writes a timecode QUOTED — the sexagesimal trap", () => {
    // `to: 3:1` unquoted is base-60 in YAML 1.1 and would load as beat 181.
    const out = run(LANE, { kick: clip({ to: "3:1" }) });
    expect(out.text).toContain('to: "3:1"');
  });

  it("reports the refs it had to resolve, and only those", () => {
    const withEv = LANE.replace(
      '{ ref: kick, start: "1:1" }',
      '{ ref: kick, start: "1:1", from: 2 }',
    );
    const out = descendWindows(withEv, (r) => WINDOWS[r], G);
    expect(out.intersected).toContain("kick");
    expect(out.intersected).not.toContain("snare");
    // 2 s is the larger `from`, so the event's own survives.
    expect(out.text).toMatch(/ref: kick, start: "1:1", from: 2\b/);
  });

  it("clears an edge the resolution decided against", () => {
    // The material's `to` is the smaller, so the event's 9 must not be left behind beside it.
    const withEv = LANE.replace(
      '{ ref: kick, start: "2:1" }',
      '{ ref: kick, start: "2:1", to: 9 }',
    );
    const out = descendWindows(withEv, (r) => WINDOWS[r], G);
    expect(out.text).not.toContain("to: 9");
  });

  it("writes nothing at all when no material states a window", () => {
    expect(descendWindows(LANE, () => undefined, G)).toMatchObject({
      wrote: 0,
      intersected: [],
    });
  });

  it("leaves a file it has nothing to do to byte-identical", () => {
    // `toString` reflows whatever it touches, and a no-effect migration would bury its own diff.
    expect(descendWindows(LANE, () => undefined, G).text).toBe(LANE);
  });

  it("moves a SEQUENCE's window the same way, in its own spelling", () => {
    // The other material kind, and the same descent: positions in the notes, timecodes only.
    const out = descendWindows(
      LANE,
      (r) => (r === "snare" ? seq({ from: "1:1", to: "5:1" }) : undefined),
      G,
    );
    expect(out.wrote).toBe(1); // the playing event
    expect(out.text).toContain('from: "1:1"');
    expect(out.text).toContain('to: "5:1"');
  });
});
