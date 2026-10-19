import { K7Document } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { chainItemPaths, formatChain, parseChain, stepSeqs } from "./chainFile";
import type { ChainFile, Item } from "./chainSchema";

// A chain file is read and validated item by item, and a rewrite keeps what it did not change: an item's source and comments.

const M = (body: string) => body.replace(/^\n/, "");

const AUTHORED = M(`
// the guitar chain
start(true)
steps([
  id("in").extends("@k7-core/io/in"),
  // the drive, set by ear
  id("drive").extends("@k7-core/audio/overdrive").params({ Amount: 5 }),
  id("verb").extends("@k7-core/audio/reverb"),
  to([chain("OUT")]),
])
`);

const read = (text: string): ChainFile => {
  const { value, issues } = parseChain(text);
  expect(issues).toEqual([]);
  return value as ChainFile;
};

describe("parseChain", () => {
  it("reads a chain written as k7x", () => {
    const chain = read(AUTHORED);
    expect(chain.start).toBe(true);
    expect(chain.steps).toHaveLength(4);
    expect(chain.steps[3]).toEqual({ to: [{ chain: "OUT" }] });
  });

  it("checks a node item as a module file, at the item's line", () => {
    const { value, issues } = parseChain(
      M(`
start(true)
steps([
  id("in").extends("@k7-core/io/in"),
  id("x").paramz({}),
])
`),
    );
    expect(value).toBeNull();
    expect(issues[0].path).toBe("steps.1.paramz");
    expect(issues[0].line).toBe(4);
  });

  it("reports a syntax error with its line", () => {
    const { value, issues } = parseChain("steps([\n");
    expect(value).toBeNull();
    expect(issues[0].line).toBeGreaterThanOrEqual(1);
  });
});

describe("the paths a writer edits through", () => {
  it("names every steps list and every item by id", () => {
    const doc = new K7Document(
      M(`
start(true)
steps([id("a").extends("x"), [id("b").extends("y"), id("c").extends("z")]])
subchains([{ id: "s", steps: [id("d").extends("w")] }])
`),
    );
    expect(stepSeqs(doc)).toEqual([["steps"], ["subchains", 0, "steps"]]);
    expect(chainItemPaths(doc)).toEqual([
      { id: "a", path: ["steps", 0] },
      { id: "b", path: ["steps", 1, 0] },
      { id: "c", path: ["steps", 1, 1] },
      { id: "d", path: ["subchains", 0, "steps", 0] },
    ]);
  });
});

describe("formatChain", () => {
  it("writes the same chain back as it was", () => {
    expect(formatChain(read(AUTHORED), AUTHORED)).toBe(AUTHORED);
  });

  it("writes a fresh file that reads back to the same data", () => {
    const chain = read(AUTHORED);
    const text = formatChain(chain);
    expect(text.startsWith("//")).toBe(false);
    expect(read(text)).toEqual(chain);
  });

  it("keeps a moved item's source and the comment above it", () => {
    const chain = read(AUTHORED);
    const [inp, drive, verb, end] = chain.steps;
    const text = formatChain(
      { ...chain, steps: [inp, verb, drive, end] },
      AUTHORED,
    );
    expect(text).toContain("// the guitar chain");
    expect(text).toMatch(
      /id\("verb"\)[^\n]*,\n {2}\/\/ the drive, set by ear\n {2}id\("drive"\)/,
    );
    expect(read(text).steps.map((s) => (s as { id?: string }).id)).toEqual([
      "in",
      "verb",
      "drive",
      undefined,
    ]);
  });

  it("writes a changed item from its data, and a new lane item on one line", () => {
    const chain = read(AUTHORED);
    const steps = [...chain.steps];
    steps[1] = { ...(steps[1] as object), params: { Amount: 7 } } as never;
    steps.splice(1, 0, { id: "gtr", track: "gtr" });
    const text = formatChain({ ...chain, steps }, AUTHORED);
    expect(text).toContain('id("gtr").track("gtr")');
    expect(text).toContain("Amount: 7");
    expect(read(text).steps).toEqual(steps);
  });

  it("keeps an item into a parallel step, re-indented", () => {
    const old = M(`
start(true)
steps([
  id("a").extends("@k7-core/io/in"),
  id("long").extends("@k7-core/audio/a-module-with-a-long-name")
    .engine("one-knob")
    .engines({ one-knob: { params: { Amount: 5, Drive: 3, Tone: 0.5 } } }),
  id("b").extends("@k7-core/audio/reverb"),
])
`);
    const chain = read(old);
    const [a, long, b] = chain.steps as Item[];
    const text = formatChain({ ...chain, steps: [a, [long, b]] }, old);
    expect(read(text).steps).toEqual([a, [long, b]]);
    // The continuation lines move with the item, two columns deeper.
    expect(text).toContain('\n      .engine("one-knob")');
    expect(text).toContain('.engine("one-knob")');
  });
});
