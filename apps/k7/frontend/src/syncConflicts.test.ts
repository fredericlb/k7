// syncConflicts.test.ts — what each side of a conflict is called, and the store's refetches:
// on its first consumer, on a pushed notice, never stacked, and never for a page with no workspace.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConflictsStore,
  describeConflict,
  type SyncConflict,
} from "./syncConflicts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const settle = () => vi.advanceTimersByTimeAsync(0);

const base = { id: "4.0", seq: 4, replica: "laptop", ts: 1, label: "edit" };

describe("describeConflict", () => {
  it("names a YAML value's path, the value kept and the one set aside", () => {
    const c: SyncConflict = {
      ...base,
      op: {
        kind: "yaml",
        file: "song/song.yaml",
        ops: [{ op: "set", path: ["tracks", "bass", "gain"], yaml: "-3" }],
      },
      kept: "-6",
    };
    expect(describeConflict(c)).toEqual({
      file: "song/song.yaml",
      paths: ["tracks.bass.gain"],
      kept: { k: "value", source: "-6" },
      alternative: { k: "value", source: "-3" },
    });
  });

  it("calls a whole text, a blob ref and a removal by what they are", () => {
    const of = (op: SyncConflict["op"]) =>
      describeConflict({ ...base, op }).alternative.k;
    expect(of({ kind: "text", file: "a.md", text: "hello" })).toBe("text");
    expect(of({ kind: "text", file: "a.wav", text: "\u0000blob:ab" })).toBe(
      "binary",
    );
    expect(of({ kind: "remove", file: "a.md" })).toBe("removed");
  });
});

describe("createConflictsStore", () => {
  it("fetches on its first consumer and on each notice, one fetch at a time", async () => {
    let calls = 0;
    let release = () => {};
    let notice = () => {};
    const store = createConflictsStore(
      () =>
        new Promise((r) => {
          calls++;
          release = () => r([]);
        }),
      (n) => {
        notice = n;
        return () => {};
      },
      () => true,
    );
    store.subscribe(() => {});
    expect(calls).toBe(1);
    notice();
    notice();
    expect(calls).toBe(1); // not stacked
    release();
    await settle();
    expect(calls).toBe(2); // one more for what came meanwhile
  });

  it("asks nothing for a page with no live workspace", async () => {
    let calls = 0;
    const store = createConflictsStore(
      async () => {
        calls++;
        return [];
      },
      () => () => {},
      () => false,
    );
    store.subscribe(() => {});
    await settle();
    expect(calls).toBe(0);
  });
});
