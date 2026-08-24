import { parseGraph } from "@studio/song-schema/yaml/graphFile";
import { describe, expect, it } from "vitest";
import { deriveChains } from "./chainsGraph";
import { migrateChainsText } from "./chainsMigrate";

// Written against the derived chains rather than the text: the question is how the song routes.

/** The chains a migrated file derives to, with the lanes coming back FROM the migration. */
const routed = (old: string) => {
  const { text, tracks } = migrateChainsText(old);
  const { value, issues } = parseGraph(text);
  expect(issues).toEqual([]);
  return deriveChains(value, (n) => tracks.includes(n));
};

/** A chain as a flat path, which is how the old file spelled it: source, steps, destination. */
const path = (c: {
  from?: string;
  use: { module: string }[];
  out: { to: string }[];
}) => [
  ...(c.from ? [c.from] : []),
  ...c.use.map((s) => s.module),
  ...c.out.map((o) => o.to),
];

describe("a chain survives as the same signal path", () => {
  it("keeps the source, the order of the modules, and the sink", () => {
    const g = routed(
      `chains:\n` +
        `  - [ { track: vo.jo }, { module: eq_dj:vox }, { module: tool }, { module: OUT } ]\n`,
    );
    expect(path(g["vo.jo"])).toEqual(["vo.jo", "eq_dj:vox", "tool", "OUT"]);
  });

  it("keeps a bypassed step bypassed", () => {
    const g = routed(
      `chains:\n` +
        `  - [ { track: a }, { module: eq, enabled: false }, { module: OUT } ]\n`,
    );
    expect(g.a.use).toEqual([{ module: "eq", enabled: false }]);
  });

  it("keeps a module that is placed but wired to nothing", () => {
    const g = routed(`chains:\n  - [ { module: "@engine/io/IN/in-1" } ]\n`);
    expect(g["@engine/io/IN/in-1"].use.map((s) => s.module)).toEqual([
      "@engine/io/IN/in-1",
    ]);
  });

  it("re-points a send at the bus's first module", () => {
    // With no chain names left, the arrow has to land on the module that chain started with.
    const g = routed(
      `chains:\n` +
        `  - [ { track: a }, { module: verb } ]\n` +
        `  - [ { track: b }, { module: verb } ]\n` +
        `  - [ { chain: verb }, { module: plate }, { module: OUT } ]\n`,
    );
    expect(g.a.out).toEqual([{ to: "plate", gain: 1 }]);
    expect(g.b.out).toEqual([{ to: "plate", gain: 1 }]);
    expect(path(g.plate)).toEqual(["plate", "OUT"]);
  });

  it("folds a bus only ONE chain fed back into that chain", () => {
    // Not a loss: a one-sender bus is a split the old format needs only to have a name.
    const g = routed(
      `chains:\n` +
        `  - [ { track: a }, { module: verb } ]\n` +
        `  - [ { chain: verb }, { module: plate }, { module: OUT } ]\n`,
    );
    expect(Object.keys(g)).toEqual(["a"]);
    expect(path(g.a)).toEqual(["a", "plate", "OUT"]);
  });

  it("loses only the chain's ALIAS, which nothing outlives", () => {
    // Only the label goes, and with it the `lead:` plugin-id prefix; the path is untouched.
    const g = routed(
      `chains:\n  - [ { track: melody, as: lead }, { module: synth }, { module: OUT } ]\n`,
    );
    expect(Object.keys(g)).toEqual(["melody"]);
    expect(path(g.melody)).toEqual(["melody", "synth", "OUT"]);
  });
});

describe("a module the old file used twice", () => {
  const SHARED =
    `chains:\n` +
    `  - [ { track: melody, as: lead }, { module: synth }, { module: OUT } ]\n` +
    `  - [ { track: pad }, { module: synth }, { module: OUT } ]\n`;

  it("becomes one node per chain", () => {
    // Left shared, two plugins collapse into one instrument summing both lanes: a different song.
    const r = migrateChainsText(SHARED);
    expect(r.split).toEqual([
      { module: "synth", nodes: ["synth:lead", "synth:pad"] },
    ]);
    const g = deriveChains(parseGraph(r.text).value, (n) =>
      r.tracks.includes(n),
    );
    expect(path(g.melody)).toEqual(["melody", "synth:lead", "OUT"]);
    expect(path(g.pad)).toEqual(["pad", "synth:pad", "OUT"]);
  });

  it("names the node so the module loader will take it", () => {
    // Node names take letters, digits, '_' and '-' only, which `da.main` is not.
    const r = migrateChainsText(
      `chains:\n` +
        `  - [ { track: da.main }, { module: comp }, { module: OUT } ]\n` +
        `  - [ { track: da.dub }, { module: comp }, { module: OUT } ]\n`,
    );
    expect(r.split[0].nodes).toEqual(["comp:da_main", "comp:da_dub"]);
  });
});

describe("running it twice", () => {
  it("leaves a file that is already segments alone", () => {
    const already = `modules:\n  a: [ eq ]\n  eq: [ OUT ]\n`;
    const r = migrateChainsText(already);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(already);
  });
});
