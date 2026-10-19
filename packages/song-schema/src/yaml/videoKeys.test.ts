// One key at a time: what would go wrong silently is a constant overwritten rather than kept as
// the shot's start, a key landing twice at one instant, and an emptied `animate:` left behind.

import { K7Document, type K7Scope, parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { removeVideoKeyAt, setVideoKeyAt } from "./videoKeys";

const edit = (text: string, fn: (doc: K7Scope) => boolean) => {
  const doc = new K7Document(text);
  return { ok: fn(doc.at([])), text: doc.toString() };
};

const animate = (text: string) =>
  (parse(text).events as Record<string, unknown>[])[0]?.animate;

const LANE = `// A-roll
events([
  ref("a").start(4).length(6).animate({ scale: 1.2 }),
])
`;

describe("setVideoKeyAt", () => {
  it("keeps a constant as the shot's start when a key is added later", () => {
    const out = edit(LANE, (d) => setVideoKeyAt(d, 0, "scale", 3, 1.5));
    expect(animate(out.text)).toEqual({
      scale: [
        [0, 1.2],
        [3, 1.5],
      ],
    });
  });

  it("replaces a key at the same instant rather than stacking two", () => {
    const once = edit(LANE, (d) => setVideoKeyAt(d, 0, "x", 1, 10)).text;
    const twice = edit(once, (d) => setVideoKeyAt(d, 0, "x", 1, 20, "out"));
    expect(animate(twice.text)).toEqual({
      scale: 1.2,
      x: [{ t: 1, v: 20, ease: "out" }],
    });
  });

  it("keeps the file's comments", () => {
    expect(edit(LANE, (d) => setVideoKeyAt(d, 0, "x", 1, 10)).text).toContain(
      "// A-roll",
    );
  });

  it("refuses a placement that is not there", () => {
    const out = edit(LANE, (d) => setVideoKeyAt(d, 3, "x", 1, 10));
    expect(out).toEqual({ ok: false, text: LANE });
  });
});

describe("removeVideoKeyAt", () => {
  it("drops the property when its last key goes, and `animate:` when nothing is left", () => {
    const keyed = edit('events([ref("a").start(0)])\n', (d) =>
      setVideoKeyAt(d, 0, "opacity", 2, 0),
    ).text;
    const out = edit(keyed, (d) => removeVideoKeyAt(d, 0, "opacity", 2));
    expect(out.ok).toBe(true);
    expect(animate(out.text)).toBeUndefined();
  });

  it("answers false when there is no key there", () => {
    const out = edit(LANE, (d) => removeVideoKeyAt(d, 0, "x", 1));
    expect(out).toEqual({ ok: false, text: LANE });
  });
});
