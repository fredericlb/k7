import { describe, expect, it } from "vitest";
import { buildGraph, type Chain, type GraphDoc, validate } from "./graph";

describe("validate", () => {
  // Every fixture ships an io sink module named OUT so a chain can terminate legitimately.
  const doc = (chains: Record<string, Chain>): GraphDoc => ({
    project: { name: "t", tempo: 120, sampleRate: 48000, timeSignature: "4/4" },
    chains,
    tracks: {},
    videoTracks: {},
    disabledTracks: [],
    modules: { OUT: { kind: "io", io: "out", inputs: [], outputs: [] } },
    moduleRefs: { OUT: { kind: "io", io: "out", inputs: [], outputs: [] } },
    warnings: [],
  });

  it("passes a clean chain routed to an io sink with no warnings", () => {
    expect(
      validate(doc({ a: { use: [], out: [{ to: "OUT", gain: 1 }] } })),
    ).toEqual([]);
  });

  it("flags a `from` that names no track or chain", () => {
    const w = validate(
      doc({ a: { from: "nope", use: [], out: [{ to: "OUT", gain: 1 }] } }),
    );
    expect(w).toContainEqual(
      expect.stringMatching(/from 'nope' is not a track or chain/),
    );
  });

  it("flags a chain with no out as a dead end", () => {
    expect(validate(doc({ a: { use: [], out: [] } }))).toContainEqual(
      expect.stringMatching(/has no out \(dead end\)/),
    );
  });

  it("flags an out that names no chain or io sink", () => {
    expect(
      validate(doc({ a: { use: [], out: [{ to: "ZZZ", gain: 1 }] } })),
    ).toContainEqual(
      expect.stringMatching(/out 'ZZZ' is not a chain or io sink/),
    );
  });

  it("flags a step whose module does not exist", () => {
    expect(
      validate(
        doc({
          a: { use: [{ module: "ghost" }], out: [{ to: "OUT", gain: 1 }] },
        }),
      ),
    ).toContainEqual(
      expect.stringMatching(
        /module 'ghost' is not a module or module instance/,
      ),
    );
  });
});

// A disabled track is ignored by the engine and draws nothing on the timeline. The graph
// follows: the track is gone, and so is any chain sourced from it — a lane that plays
// nothing feeding a chain that runs nothing is a diagram-shaped lie.
describe("disabled tracks (and the chains they feed)", () => {
  // A lane is a module now, so the fixture builds ONE map: the lanes, plus the sink they end
  // at. `kind: "track"` is what makes a node a lane, and its output port is what it carries.
  const lane = (extra: Record<string, unknown> = {}) => ({
    kind: "track",
    category: "tracks",
    inputs: [],
    outputs: [{ name: "out", type: "audio" }],
    ...extra,
  });
  const group = (members: string[]) => ({
    kind: "track",
    category: "tracks",
    inputs: [],
    outputs: [],
    tracks: members,
  });
  const OUT = { kind: "io", io: "out", inputs: [], outputs: [] };
  const build = (lanes: Record<string, unknown>, chains: unknown) => {
    const modules = { OUT, ...lanes, reverb: { kind: "plugin", inputs: [] } };
    return buildGraph(
      { project: {} },
      chains,
      {},
      {},
      modules as unknown as Parameters<typeof buildGraph>[4],
      modules as unknown as Parameters<typeof buildGraph>[5],
    );
  };

  it("drops a disabled lane and the chain sourced from it, keeping the rest", () => {
    const g = build(
      { melody: lane(), pad: lane({ disabled: true }) },
      { modules: { melody: ["OUT"], pad: ["OUT"] } },
    );
    expect(Object.keys(g.tracks)).toEqual(["melody"]);
    expect(g.disabledTracks).toEqual(["pad"]);
    expect(Object.keys(g.chains)).toEqual(["melody"]);
    // …and no warning about the chain that's simply gone.
    expect(g.warnings).toEqual([]);
  });

  it("keeps a BUS chain alive when one of its sources is disabled", () => {
    // A bus has no `from` to test, and is routed into by `out` from several chains —
    // disabling one source must not take the shared reverb down with it.
    const g = build(
      { melody: lane(), pad: lane({ disabled: true }) },
      // A bus is a module SEVERAL things feed — which is the only way to write one now,
      // and exactly what makes it a chain of its own.
      { modules: { melody: ["reverb"], pad: ["reverb"], reverb: ["OUT"] } },
    );
    expect(Object.keys(g.chains).sort()).toEqual(["melody", "reverb"]);
  });

  it("keeps warning about a node that names nothing at all", () => {
    // It used to read as a dangling `from`, because a name in `tracks:` could only be a lane.
    // With one map an unknown name is an unknown MODULE, which is the more honest diagnosis —
    // and the chain is still drawn, because it is a mistake you have to be able to see.
    const g = build({}, { modules: { ghost: ["OUT"] } });
    expect(Object.keys(g.chains)).toEqual(["ghost"]);
    expect(g.warnings).toContainEqual(
      expect.stringMatching(/step module 'ghost' is not a module/),
    );
  });

  it("doesn't call a group's disabled member missing", () => {
    const g = build(
      { pad: lane({ disabled: true }), live: group(["pad", "ghost"]) },
      {},
    );
    // The disabled member is deliberate; only the one that exists nowhere is flagged.
    expect(g.warnings).toEqual([
      expect.stringMatching(/group 'live': track 'ghost' not found/),
    ]);
  });
});
