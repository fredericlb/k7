// The sockets a node shows.
//
// Two rules that pull against each other, which is why they are worth pinning. A port that MUST be fed is
// something to say up front, so every mandatory one is drawn before anything is wired. An optional one is an
// offer, and a module with five of them would otherwise present five empty holes to a reader using two — so
// past the mandatory ones exactly one free socket appears, beyond the last occupied port.
//
// Outputs have no such progression: an output is offered, never required, so all of them show at once.
//
// See docs/graphBuild.md.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  cablePath,
  type GraphNode,
  jackPoint,
  jacksFor,
  layout,
  PORT_PLATE,
} from "./graph";

const AUDIO = "audio" as const;

/** Two audio inputs, the second optional — the crossfade of `@studio/song`'s docs/ports.md. */
const CROSSFADE = [
  { name: "a", type: AUDIO },
  { name: "b", type: AUDIO, mandatory: false },
];

const fed = (...ports: string[]) => new Set(ports);

describe("jacksFor", () => {
  it("gives a module that declares nothing the one socket every module has", () => {
    // Unnamed on purpose: there is nothing to disambiguate, and calling it "in" would be noise on
    // every node in the song.
    expect(jacksFor(undefined, fed(), "midi", true)).toEqual([
      { type: "midi", free: true },
    ]);
    expect(jacksFor([], fed(""), undefined, true)).toEqual([
      { type: "audio", free: false },
    ]);
  });

  it("shows the mandatory port alone until something is wired to it", () => {
    // One mandatory, one optional, nothing connected: the offer is the mandatory one. Showing `b`
    // here would advertise a second input before the first has been used.
    expect(jacksFor(CROSSFADE, fed(), AUDIO, true)).toEqual([
      { name: "a", type: AUDIO, free: true },
    ]);
  });

  it("reveals the next one as soon as the flow arrives", () => {
    // A bare cable feeds the FIRST port, which is what "" means — every chain written before ports
    // existed says exactly this.
    expect(jacksFor(CROSSFADE, fed(""), AUDIO, true)).toEqual([
      { name: "a", type: AUDIO, free: false },
      { name: "b", type: AUDIO, free: true },
    ]);
  });

  it("stops at what the module declares", () => {
    // Both fed: there is no third port to offer, and inventing an empty one would promise an input
    // no cable could ever land on.
    expect(jacksFor(CROSSFADE, fed("", "b"), AUDIO, true)).toEqual([
      { name: "a", type: AUDIO, free: false },
      { name: "b", type: AUDIO, free: false },
    ]);
  });

  it("keeps a lower port visible when only a higher one is wired", () => {
    // One past the LAST occupied port, not one past the count. Fed only on `b`, a module still has
    // to show `a` — otherwise the socket the reader is looking for vanishes from under the cable.
    const three = [...CROSSFADE, { name: "c", type: AUDIO, mandatory: false }];
    expect(jacksFor(three, fed("b"), AUDIO, true)).toEqual([
      { name: "a", type: AUDIO, free: true },
      { name: "b", type: AUDIO, free: false },
      { name: "c", type: AUDIO, free: true },
    ]);
  });

  it("draws every mandatory port at once, however many there are", () => {
    const both = [
      { name: "a", type: AUDIO },
      { name: "b", type: AUDIO },
    ];
    expect(jacksFor(both, fed(), AUDIO, true).map((j) => j.name)).toEqual([
      "a",
      "b",
    ]);
  });

  it("shows all the outputs from the start, since none of them is progressive", () => {
    const outs = [
      { name: "main", type: AUDIO },
      { name: "cue", type: AUDIO },
    ];
    expect(jacksFor(outs, fed(""), AUDIO, false)).toEqual([
      { name: "main", type: AUDIO, free: false },
      { name: "cue", type: AUDIO, free: false },
    ]);
    // …and with nothing leaving the module, they read as unplugged rather than as connected.
    expect(jacksFor(outs, fed(), AUDIO, false).every((j) => j.free)).toBe(true);
  });
});

describe("the sockets a built graph puts on its nodes", () => {
  // deckA flows into the crossfade; deckB lands on its `b` port. The song this draws is
  // engine/capot/songs/crossfade-demo.
  const wired: WebGraph = {
    chains: {
      deckA: {
        from: "deckA",
        use: [{ module: "crossfade", inputs: CROSSFADE, emits: AUDIO }],
        out: [{ to: "OUT", gain: 1 }],
      },
      deckB: { from: "deckB", use: [], out: [{ to: "crossfade#b", gain: 1 }] },
    },
    tracks: ["deckA", "deckB"],
    warnings: [],
  };

  it("counts a ported cable against the port it names", () => {
    const { nodes } = buildGraph(wired);
    const xf = nodes.find((n) => n.id === "mod:crossfade");
    expect(xf?.jacks?.in).toEqual([
      { name: "a", type: AUDIO, free: false }, // deckA's flow
      { name: "b", type: AUDIO, free: false }, // deckB, by name
    ]);
    expect(xf?.jacks?.out).toHaveLength(1);
  });

  it("leaves a track with no input socket and a sink with no output one", () => {
    // A lane's material is its clips — there is no jack for a reader to look for — and a sink is
    // the mirror image: somewhere to arrive, nowhere to leave.
    const { nodes } = buildGraph(wired);
    expect(nodes.find((n) => n.id === "trk:deckA")?.jacks?.in).toEqual([]);
    expect(nodes.find((n) => n.id === "trk:deckA")?.jacks?.out).toHaveLength(1);
    expect(nodes.find((n) => n.id === "snk:OUT")?.jacks?.out).toEqual([]);
    expect(nodes.find((n) => n.id === "snk:OUT")?.jacks?.in).toHaveLength(1);
  });

  it("does not let an automation arrow occupy an input", () => {
    // A curve drives a knob; it does not plug into the module. Counted as a feeder it would have
    // revealed the next free socket for no reason, and on a one-input module marked it connected.
    const { nodes } = buildGraph({
      chains: {
        a: {
          from: "t",
          use: [
            {
              module: "amp",
              emits: AUDIO,
              automations: [{ param: "Gain", curve: "sweep" }],
            },
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: ["t"],
      curves: { sweep: { type: "custom" } },
      warnings: [],
    });
    // Fed by the track and by nothing else: one socket, occupied.
    expect(nodes.find((n) => n.id === "mod:amp")?.jacks?.in).toEqual([
      { type: AUDIO, free: false },
    ]);
  });

  it("carries the port through layout, where it used to be dropped", () => {
    // `targetPort` was set on the raw edge and then left out of the laid-out one, so the jack a
    // cable named never reached the renderer and every ported cable landed on the node's border.
    const { nodes, edges } = buildGraph(wired);
    const laid = layout(nodes, edges);
    // deckB runs no modules, so what leaves it is its chain's pass-through node — the port is on
    // the cable that arrives, wherever it started.
    const side = laid.edges.filter((e) => e.target === "mod:crossfade");
    expect(side.map((e) => e.targetPort).filter(Boolean)).toEqual(["b"]);
  });
});

// A cable ends in a PLUG, and a plug goes in a hole. dagre routes to the node's border, which was the right
// target while the cable ended in an arrowhead pointing at a card; the ends are moved onto the sockets here.
describe("where a cable plugs in", () => {
  const node = (over: Partial<GraphNode>): GraphNode =>
    ({
      id: "n",
      label: "n",
      kind: "module",
      dim: false,
      missing: false,
      stub: false,
      notSupported: false,
      unknownPlugin: false,
      hasNativePluginUI: false,
      w: 160,
      h: 70,
      x: 100,
      y: 200,
      ...over,
    }) as GraphNode;

  const twoIn = node({
    jacks: {
      in: [
        { name: "a", type: AUDIO, free: false },
        { name: "b", type: AUDIO, free: false },
      ],
      out: [{ type: AUDIO, free: false }],
    },
  });

  it("puts a socket where the renderer draws it", () => {
    // The plate steps off the card and the barrel is centred in it, so the point is half a plate outside the
    // edge; the sockets are spread evenly down it, matching the `top` percentages the node sets inline.
    expect(jackPoint(twoIn, "in", 0)).toEqual({
      x: 100 - PORT_PLATE / 2,
      y: 200 + 70 / 3,
    });
    expect(jackPoint(twoIn, "in", 1)).toEqual({
      x: 100 - PORT_PLATE / 2,
      y: 200 + (70 * 2) / 3,
    });
    expect(jackPoint(twoIn, "out", 0)).toEqual({
      x: 100 + 160 + PORT_PLATE / 2,
      y: 200 + 35,
    });
  });

  it("lands a ported cable on the socket it names, not on the first", () => {
    const src = node({
      id: "s",
      x: -200,
      y: 200,
      jacks: { in: [], out: [{ type: AUDIO, free: false }] },
    });
    const path = cablePath(
      {
        id: "e",
        source: "s",
        target: "n",
        targetPort: "b",
        points: [
          { x: -40, y: 235 },
          { x: 100, y: 235 },
        ],
      },
      src,
      twoIn,
    );
    expect(path[path.length - 1]).toEqual(jackPoint(twoIn, "in", 1));
    expect(path[0]).toEqual(jackPoint(src, "out", 0));
  });

  it("leaves and enters straight, so a cable comes out of the plate square", () => {
    const src = node({
      id: "s",
      x: -200,
      y: 200,
      jacks: { in: [], out: [{ type: AUDIO, free: false }] },
    });
    const path = cablePath(
      {
        id: "e",
        source: "s",
        target: "n",
        points: [
          { x: -40, y: 235 },
          { x: 100, y: 235 },
        ],
      },
      src,
      twoIn,
    );
    // A lead at each end, level with its socket: the bend starts after the plug, not on it.
    expect(path[1].y).toBe(path[0].y);
    expect(path[1].x).toBeGreaterThan(path[0].x);
    expect(path[path.length - 2].y).toBe(path[path.length - 1].y);
    expect(path[path.length - 2].x).toBeLessThan(path[path.length - 1].x);
  });

  it("keeps dagre's waypoints in between", () => {
    // The bends are what make a send skirt the module it skips; only the ENDS move.
    const bend = { x: 20, y: 400 };
    const path = cablePath(
      {
        id: "e",
        source: "s",
        target: "n",
        points: [{ x: -40, y: 235 }, bend, { x: 100, y: 235 }],
      },
      undefined,
      twoIn,
    );
    expect(path).toContainEqual(bend);
  });

  it("falls back to dagre's own end when a node is missing", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    const path = cablePath(
      { id: "e", source: "?", target: "?", points: pts },
      undefined,
      undefined,
    );
    expect(path[0]).toEqual(pts[0]);
    expect(path[path.length - 1]).toEqual(pts[1]);
  });
});
