// chain.test.ts — a chained graph is the same graph as its builder calls, node for node, and the rates stay apart.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { type GraphBuilder, graph } from "./index";

const same = (a: (g: GraphBuilder) => void, b: (g: GraphBuilder) => void) =>
  expect(JSON.stringify(graph(a), null, 2)).toBe(
    JSON.stringify(graph(b), null, 2),
  );

describe("chaining", () => {
  it("writes the audio nodes the calls write, in the same order", () => {
    same(
      (g) => {
        const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });
        g.output(
          g.aadd(g.amul(g.input(0), g.sub(1, mix)), g.amul(g.input(1), mix)),
        );
      },
      (g) => {
        const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });
        g.input(0).mul(mix.from(1)).add(g.input(1).mul(mix)).out();
      },
    );
  });

  it("writes the scalar nodes the calls write", () => {
    same(
      (g) => {
        const x = g.param("X", { min: 0, max: 1, default: 0 });
        g.gain(g.fromdb(g.clamp(g.glide(g.mul(g.add(x, 1), 2)), -6, 6)));
      },
      (g) => {
        const x = g.param("X", { min: 0, max: 1, default: 0 });
        g.gain(x.add(1).mul(2).glide().clamp(-6, 6).fromdb());
      },
    );
  });

  it("writes the note nodes the calls write, on the one stream", () => {
    same(
      (g) => {
        const m = g.midi();
        g.strike(g.pattern(g.hold(m), 2, 8, 0.5, 0), 0.25, 0.5);
      },
      (g) => {
        g.midi().hold().pattern(2, 8, 0.5, 0).strike(0.25, 0.5);
      },
    );
  });

  it("keeps a wire from passing for a parameter", () => {
    graph((g) => {
      const x = g.param("X", { min: 0, max: 1, default: 0 });
      // @ts-expect-error — a scalar's mul takes scalars; an audio wire is a different type.
      expect(() => x.mul(g.input(0))).not.toThrow();
    });
  });
});

const ROOT = join(import.meta.dirname, "..", "..", "..");
const MODULES = [
  "demos/_modules/audio/crossfade",
  "k7-core/modules/audio/eq/engines/parametric",
].filter((d) => existsSync(join(ROOT, d, "jsdsp.ts")));

describe("the modules written with chains", () => {
  it.each(MODULES)("%s still emits its committed graph", async (dir) => {
    const m = await import(pathToFileURL(join(ROOT, dir, "jsdsp.ts")).href);
    const committed = JSON.parse(
      readFileSync(join(ROOT, dir, "jsdsp.json"), "utf8"),
    );
    expect(graph(m.default)).toEqual(committed);
  });
});
