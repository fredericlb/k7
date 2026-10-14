import { describe, expect, it } from "vitest";
import { allow, BURST, checkComment, sweep, WINDOW_MS } from "./commentGate.ts";
import { MAX_BODY } from "./comments.ts";

describe("what a comment must be", () => {
  it("trims, and an empty one is not a comment", () => {
    expect(checkComment({ body: "  \n " }).ok).toBe(false);
    const r = checkComment({ body: "  la basse  ", author: " Zoé " });
    expect(r).toMatchObject({
      ok: true,
      value: { body: "la basse", author: "Zoé" },
    });
  });

  it("stops at the ceiling rather than storing a payload", () => {
    expect(checkComment({ body: "x".repeat(MAX_BODY + 1) }).ok).toBe(false);
    expect(checkComment({ body: "x", author: "n".repeat(200) }).ok).toBe(false);
  });

  it("reads absent, null, NaN and negative as ONE answer: no timecode", () => {
    for (const at of [undefined, null, Number.NaN, -3, "12"])
      expect(checkComment({ body: "x", at })).toMatchObject({
        value: { at: null },
      });
    expect(checkComment({ body: "x", at: 0 })).toMatchObject({
      value: { at: 0 },
    });
  });
});

describe("the window", () => {
  it("lets a burst through and then stops", () => {
    const w = new Map();
    for (let i = 0; i < BURST; i++) expect(allow(w, "ip", 1000)).toBe(true);
    expect(allow(w, "ip", 1000)).toBe(false);
  });

  it("rolls over, and one address does not spend another's", () => {
    const w = new Map();
    for (let i = 0; i < BURST; i++) allow(w, "a", 0);
    expect(allow(w, "b", 0)).toBe(true);
    expect(allow(w, "a", WINDOW_MS)).toBe(true);
  });

  it("forgets what has expired, so a long-lived process does not grow", () => {
    const w = new Map();
    allow(w, "a", 0);
    sweep(w, WINDOW_MS);
    expect(w.size).toBe(0);
  });
});
