import { describe, expect, it } from "vitest";
import { deriveChains } from "./chainsGraph";
import { migrateChainsText } from "./chainsMigrate";
import { parseGraph } from "./yaml/graphFile";

// A migration is only as good as what it PRESERVES, so the tests are written against the
// derived chains rather than the text: the question is never "does the new file look
// right", it is "does the song still route the same way".

/**
 * The chains a migrated file derives to — the shape every consumer downstream reads.
 *
 * The lanes come back FROM the migration: the new file is one `modules:` map, so only what a
 * name extends tells a lane from a reverb, and the old `{ track: … }` heads are the last place
 * that is written down (docs/trackModules.md).
 */
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
    // The old file routed to a chain by NAME; there are no chain names now, so the arrow
    // has to land on the module that chain started with — the same node, differently
    // spelled. Getting this wrong would leave the send pointing at nothing.
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
    // Not a loss: a bus with a single sender was a chain split in two because the old
    // format needed a name to route to. Nothing routes by name now, so the two halves are
    // one run again — and the signal passes through exactly the same modules, in order.
    const g = routed(
      `chains:\n` +
        `  - [ { track: a }, { module: verb } ]\n` +
        `  - [ { chain: verb }, { module: plate }, { module: OUT } ]\n`,
    );
    expect(Object.keys(g)).toEqual(["a"]);
    expect(path(g.a)).toEqual(["a", "plate", "OUT"]);
  });

  it("loses only the chain's ALIAS, which nothing outlives", () => {
    // `as:` renamed a chain; a chain is now called after its track, full stop. The path
    // is untouched — only the label is gone, and with it the `lead:` plugin-id prefix.
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
    // The old format compiled this to TWO plugins (ids `lead:synth` and `pad:synth`).
    // A segment file names a module once, so leaving it shared would collapse it into a
    // single node fed by both tracks — one instrument summing two lanes. That is a
    // different song, so the migration splits it instead.
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
    // Node names allow letters, digits, '_' and '-' only, and plenty of track ids
    // (`da.main`) do not. An unusable name would leave the split module unloadable.
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
