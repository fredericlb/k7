// The menu's title row: what it is on, named as the screen names it, and nothing for a context that names nothing.

import { describe, expect, it } from "vitest";
import { menuTarget } from "./menuTitle";

const names = {
  lane: (id: string) => (id === "da.drums" ? "drums" : id),
  clip: (ref: string) => (ref === "keys-seq-1" ? "keys sequence 1" : ref),
};

describe("menuTarget", () => {
  it("names a lane by its label and a clip by its shown name", () => {
    expect(menuTarget({ kind: "track", id: "da.drums" }, names)).toEqual({
      entity: "track",
      name: "drums",
    });
    expect(
      menuTarget({ kind: "clip", id: "keys-seq-1", track: "keys" }, names),
    ).toEqual({ entity: "event", name: "keys sequence 1" });
  });

  it("names a node, a rack's pad and a roll's note", () => {
    expect(menuTarget({ kind: "module", id: "delay" })).toEqual({
      entity: "node",
      name: "delay",
    });
    expect(menuTarget({ kind: "tap", id: "kit", symbol: "BD" })).toEqual({
      entity: "tap",
      name: "BD · kit",
    });
    expect(
      menuTarget(
        { kind: "note", sequence: "keys-seq-1", note: 60, start: 0, end: 1 },
        names,
      ),
    ).toEqual({ entity: "note", name: "C4 · keys sequence 1" });
  });

  it("reads an id as itself without namers", () => {
    expect(menuTarget({ kind: "track", id: "da.drums" })?.name).toBe(
      "da.drums",
    );
  });

  it("names nothing for a chain or a sink", () => {
    expect(menuTarget({ kind: "chain", id: "main" })).toBeNull();
    expect(menuTarget({ kind: "sink", id: "out" })).toBeNull();
  });
});
