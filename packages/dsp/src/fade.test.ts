// The fade — the library's worked example of a module whose OPPOSITE is another instance of itself.
//
// What can go silently wrong here is the port count. A fade reads ONE input, and that is the whole
// difference from the crossfade beside it: two fades facing opposite ways blend two signals without
// either of them ever having to reach the other's track. A stray `input(1)` would compile, play, and
// quietly reintroduce the second port — with it, the sidechain, and with that everything that
// mechanism drags in (engine/st0-engine/docs/sidechain.md).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fade } from "./fade";
import type { GraphJson } from "./index";

const here = dirname(fileURLToPath(import.meta.url));

describe("the fade graph", () => {
  const g = fade();

  it("has ONE parameter, and it is the gain itself", () => {
    // Not a position a reader has to convert: a panel showing 0 is silent and 1 is full.
    expect(g.params.map((p) => p.name)).toEqual(["Level"]);
    // Full by default, so a module dropped into a chain alone is not a silence to debug.
    expect(g.params[0].default).toBe(1);
  });

  it("reads ONE port — the whole difference from the crossfade", () => {
    const ports = g.nodes
      .filter((n) => n.type === "ain")
      .map((n) => n.port ?? 0);
    expect(ports).toEqual([0]);
  });

  it("applies the parameter DIRECTLY, with no arithmetic in between", () => {
    // The whole point of the last rewrite: nothing between the panel's number and the gain.
    expect(g.nodes.some((n) => n.type === "sub")).toBe(false);
    expect(g.nodes.some((n) => n.type === "add")).toBe(false);
    const [amul] = g.nodes.filter((n) => n.type === "amul");
    expect(amul.k).toEqual(["Level"]);
  });

  it("is what graphs/fade.json holds — the artifact that actually runs", () => {
    const committed = JSON.parse(
      readFileSync(join(here, "..", "graphs", "fade.json"), "utf8"),
    ) as GraphJson;
    expect(g).toEqual(committed);
  });
});
