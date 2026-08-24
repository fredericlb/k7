// The fade — the library's worked example of a module whose OPPOSITE is another instance of itself.
//
// What can go silently wrong here is the port count. A fade reads ONE input, and that is the whole
// difference from the crossfade beside it: two fades facing opposite ways blend two signals without
// either of them ever having to reach the other's track. A stray `input(1)` would compile, play, and
// quietly reintroduce the second port — with it, the sidechain, and with that everything that
// mechanism drags in (engine/moteur/docs/sidechain.md).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fade } from "./fade";
import type { GraphJson } from "./index";

const here = dirname(fileURLToPath(import.meta.url));

describe("the fade graph", () => {
  const g = fade();

  it("has the control a desk drives and the one a node sets", () => {
    expect(g.params.map((p) => p.name)).toEqual(["Mix", "Side"]);
    // Both at 0: a module dropped in alone is FULL, so an unwired fade is not a silence to debug.
    expect(g.params.every((p) => p.default === 0)).toBe(true);
  });

  it("reads ONE port — the whole difference from the crossfade", () => {
    const ports = g.nodes
      .filter((n) => n.type === "ain")
      .map((n) => n.port ?? 0);
    expect(ports).toEqual([0]);
  });

  it("runs the gain the opposite way when Side is 1", () => {
    // (1−Side)·(1−Mix) + Side·Mix, so both subtractions are against 1 and both products meet in an add.
    const subs = g.nodes.filter((n) => n.type === "sub");
    expect(subs.map((n) => n.in)).toEqual([
      [1, "Side"],
      [1, "Mix"],
    ]);
    expect(g.nodes.filter((n) => n.type === "mul")).toHaveLength(2);
    expect(g.nodes.some((n) => n.type === "add")).toBe(true);
  });

  it("is what graphs/fade.json holds — the artifact that actually runs", () => {
    const committed = JSON.parse(
      readFileSync(join(here, "..", "graphs", "fade.json"), "utf8"),
    ) as GraphJson;
    expect(g).toEqual(committed);
  });

  it("matches the copy in `modules/` — the authored article", () => {
    // A module is a FOLDER you can copy, so the fade exists twice on purpose — ../docs/catalogue.md.
    const authored = JSON.parse(
      readFileSync(
        join(here, "..", "modules", "audio", "utility", "fade", "jsdsp.json"),
        "utf8",
      ),
    ) as GraphJson;
    expect(g).toEqual(authored);
  });
});
