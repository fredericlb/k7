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

  it("refuses a TRANSITION on a chain, by name — a cut names one, a cable never does", () => {
    // Its declared ports cannot say this: an empty `inputs` means UNCONSTRAINED (normalizeInputs),
    // so the refusal has to be a line of its own. See song-video/docs/transitions.md.
    const g = doc({
      a: { use: [{ module: "wipe" }], out: [{ to: "OUT", gain: 1 }] },
    });
    g.modules.wipe = {
      kind: "plugin",
      category: "video_transitions",
      inputs: [],
      outputs: [],
    };
    expect(validate(g)).toContainEqual(
      expect.stringMatching(
        /'wipe' is a transition, and a transition is not wired/,
      ),
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
      expect.stringMatching(/module 'ghost' is not a module or module node/),
    );
  });
});

// A disabled track goes, and so does any chain sourced from it: both would be a diagram-shaped lie.
describe("disabled tracks (and the chains they feed)", () => {
  // One map, since a lane is a module: `kind: "track"` is what makes a node a lane.
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
    // A bus has no `from` to test, so disabling one source must not take the reverb with it.
    const g = build(
      { melody: lane(), pad: lane({ disabled: true }) },
      // A bus is a module SEVERAL things feed, which is what makes it a chain of its own.
      { modules: { melody: ["reverb"], pad: ["reverb"], reverb: ["OUT"] } },
    );
    expect(Object.keys(g.chains).sort()).toEqual(["melody", "reverb"]);
  });

  it("keeps warning about a node that names nothing at all", () => {
    // With one map an unknown name is an unknown MODULE, and the chain is still drawn to be seen.
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
