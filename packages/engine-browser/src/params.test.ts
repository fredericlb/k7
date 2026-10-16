import { describe, expect, it } from "vitest";
import { PluginParamsStore, pickParams, sameParams } from "./params";

// A watched plugin's full value set arrives ~20×/s whether or not anything moved; only a change may wake a reader.

describe("sameParams", () => {
  it("holds two sets with the same names and numbers equal", () => {
    expect(sameParams({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
  it("tells a moved number, a missing name and nothing held apart", () => {
    expect(sameParams({ a: 1 }, { a: 1.5 })).toBe(false);
    expect(sameParams({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(sameParams(undefined, {})).toBe(false);
  });
  it("counts NaN as itself, so a param stuck on it does not wake anybody", () => {
    expect(sameParams({ a: Number.NaN }, { a: Number.NaN })).toBe(true);
  });
});

describe("PluginParamsStore.set", () => {
  it("wakes nobody and keeps the map when a frame repeats what is held", () => {
    const store = new PluginParamsStore();
    let all = 0;
    let one = 0;
    store.subscribe(() => all++);
    store.subscribeTo("deckA:eq", () => one++);
    store.set("deckA:eq", { low: 0, mid: 0 });
    const map = store.getSnapshot();
    store.set("deckA:eq", { low: 0, mid: 0 });
    expect(store.getSnapshot()).toBe(map);
    expect([all, one]).toEqual([1, 1]);
    store.set("deckA:eq", { low: -3, mid: 0 });
    expect([all, one]).toEqual([2, 2]);
  });
});

describe("pickParams", () => {
  const keys = [
    { id: "deckA:eq", name: "low" },
    { id: "mix:x", name: "pos" },
  ];

  it("cuts the map down to the watched params", () => {
    const map = {
      "deckA:eq": { low: 1, mid: 2 },
      "mix:x": { pos: 0.5 },
      other: { v: 9 },
    };
    expect(pickParams(map, keys)).toEqual({
      "deckA:eq": { low: 1 },
      "mix:x": { pos: 0.5 },
    });
  });

  it("answers the SAME object while none of them moved, whatever else did", () => {
    const first = pickParams(
      { "deckA:eq": { low: 1, mid: 2 }, "mix:x": { pos: 0.5 } },
      keys,
    );
    const again = pickParams(
      { "deckA:eq": { low: 1, mid: 7 }, "mix:x": { pos: 0.5 } },
      keys,
      first,
    );
    expect(again).toBe(first);
  });

  it("answers a new object when one of them moved, appeared or left", () => {
    const first = pickParams({ "deckA:eq": { low: 1 } }, keys);
    expect(pickParams({ "deckA:eq": { low: 2 } }, keys, first)).not.toBe(first);
    expect(
      pickParams({ "deckA:eq": { low: 1 }, "mix:x": { pos: 0 } }, keys, first),
    ).not.toBe(first);
    expect(pickParams({}, keys, first)).toEqual({});
  });
});
