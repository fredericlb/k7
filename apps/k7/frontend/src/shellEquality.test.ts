// The bails that keep the shell still: a child re-sending what it already said must not re-render App.

import { describe, expect, it } from "vitest";
import {
  type EditFocus,
  keepIfEqual,
  keepIfSame,
  sameEditFocus,
  sameJson,
  shallowEqual,
} from "./shellEquality";
import type { WebClip, WebProject } from "./types";

const project = {
  tempo: 120,
  timeSigNumerator: 4,
  timeSigDenominator: 4,
} as WebProject;
const clip = {
  id: "c1",
  type: "midi",
  name: "c1",
  start: 0,
  length: 4,
  notes: [],
} as unknown as WebClip;

describe("sameEditFocus", () => {
  it("a sequence is the same focus while its path is", () => {
    expect(
      sameEditFocus(
        { kind: "seq", path: "a.k7x" },
        { kind: "seq", path: "a.k7x" },
      ),
    ).toBe(true);
    expect(
      sameEditFocus(
        { kind: "seq", path: "a.k7x" },
        { kind: "seq", path: "b.k7x" },
      ),
    ).toBe(false);
  });

  it("a clip is new when it changes, or its grid does", () => {
    const a: EditFocus = { kind: "clip", project, clip };
    expect(
      sameEditFocus(a, {
        kind: "clip",
        project: { ...project },
        clip: { ...clip },
      }),
    ).toBe(true);
    expect(
      sameEditFocus(a, { kind: "clip", project, clip: { ...clip, length: 8 } }),
    ).toBe(false);
    expect(
      sameEditFocus(a, {
        kind: "clip",
        project: { ...project, tempo: 90 },
        clip,
      }),
    ).toBe(false);
    expect(sameEditFocus(a, { kind: "clip", project, clip, track: "t2" })).toBe(
      false,
    );
  });

  it("a sequence and a clip are never the same", () => {
    expect(
      sameEditFocus(
        { kind: "seq", path: "c1" },
        { kind: "clip", project, clip },
      ),
    ).toBe(false);
  });
});

describe("shallowEqual / keepIfEqual", () => {
  const view = { mode: "normal", selecting: false, zoomed: false };

  it("keeps the current object when the next one says the same thing", () => {
    expect(keepIfEqual({ ...view })(view)).toBe(view);
  });

  it("takes the next object when one field moved", () => {
    const next = { ...view, selecting: true };
    expect(keepIfEqual(next)(view)).toBe(next);
  });

  it("a missing or extra key is a difference", () => {
    expect(shallowEqual<object>({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it("compares by identity, not deeply", () => {
    expect(shallowEqual({ a: [1] }, { a: [1] })).toBe(false);
  });
});

describe("sameJson / keepIfSame — a poll answering what it answered before", () => {
  const hints = { paths: { "module:a": "m/a.k7x" }, racks: { k: [1, 2] } };

  it("calls two answers with the same content equal, whatever the key order", () => {
    expect(
      sameJson(hints, {
        racks: { k: [1, 2] },
        paths: { "module:a": "m/a.k7x" },
      }),
    ).toBe(true);
  });

  it("tells a changed leaf, a longer list or a missing key apart", () => {
    expect(sameJson(hints, { ...hints, racks: { k: [1, 3] } })).toBe(false);
    expect(sameJson([1, 2], [1, 2, 3])).toBe(false);
    expect(sameJson({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameJson({ a: undefined }, {})).toBe(false);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });

  it("keeps the current object when the next says the same", () => {
    const next = JSON.parse(JSON.stringify(hints));
    expect(keepIfSame(next)(hints)).toBe(hints);
    const moved = { ...next, paths: {} };
    expect(keepIfSame(moved)(hints)).toBe(moved);
  });

  it("keeps an empty findings list across revisions", () => {
    const cur: unknown[] = [];
    expect(keepIfSame<unknown[]>([])(cur)).toBe(cur);
  });
});
