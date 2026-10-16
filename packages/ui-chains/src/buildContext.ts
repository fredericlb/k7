// buildContext.ts — the state one `buildGraph` run shares between its steps: the node and edge
// maps, the id scheme, and the three writers every step goes through (`add`, `addSink`, `link`).
// A step never touches the maps' keys itself, so an id or a dedup rule is spelled once here.
// See docs/graphBuild.md.

import type { WebGraph, WebSignal } from "@studio/graph-model";
import {
  clipSpanOf,
  MAIN_OUT,
  MIX_OUT,
  NODE_H,
  NODE_W,
  nodeSize,
  RENDER_OUT,
  VIDEO_OUT,
} from "./geometry";
import type { RawEdge, RawNode } from "./graphNode";
import type { GridFit } from "./gridFit";
import { MAIN_OUT_UI, RENDER_UI } from "./nodeUIs";

/** What a host tells `buildGraph` beyond the document: the devices, the machine, the shape to draw. */
export interface BuildOptions {
  /** Draw a card for the DEVICES the signal leaves by, `VIDEO_OUT` included. The DEFAULT. See docs/graphBuild.md. */
  drawMainOut?: boolean;
  /** The song's output level in dB — a project setting, so not in the graph document. Absent ⇒ unknown. */
  mainOutVolume?: number;
  /** Which row of `RENDER_UI`'s dropdown is ticked, the frame's shape — undefined with no picture, the card then bare. */
  aspect?: number;
  /** How the machine's interface groups its inputs — the sound card's to say, not the document's. */
  inputDevices?: readonly { name: string; channels: number[] }[];
  /** The CAMERAS this browser can see, by label — the browser's to say, not the document's. */
  cameras?: readonly string[];
  /** The MIDI inputs this browser sees, by name — what a midi-in node's dropdown offers. */
  midiDevices?: readonly string[];
  /** Hold every card's grid to so many rows or columns, the overflow folded onto the other side (gridFit.ts). */
  fit?: GridFit;
  /** Which of a panel's two shapes to draw: its own (horizontal, the default) or its narrow twin, tabs as a menu. */
  layout?: "horizontal" | "vertical";
}

/** A node's fields minus its id and size, which `add` fills in. */
type NodeFields = Omit<RawNode, "id" | "w" | "h"> & { w?: number; h?: number };

/** One run's shared state and writers — see the file header. */
export interface Build {
  graph: WebGraph;
  opts: BuildOptions;
  nodes: Map<string, RawNode>;
  /** Keyed by "source->target", so a connection is drawn once. */
  edges: Map<string, RawEdge>;
  /** Which curves a binding put on the graph, so the ones nothing binds can be drawn beside them. */
  boundCurves: Set<string>;
  /** The maximum step index a module holds across chains, so a shared one ranks after every pipeline. */
  moduleRank: Map<string, number>;
  /** A fader's lane, INVERTED once: the document keys by track like its neighbours, and a node asks the other way. */
  mixerOwner: Map<string, string>;
  /** Once for the whole graph, so every lane's mini timeline is drawn against the same ruler. */
  clipSpan: number;
  /** Every module that appears as a step somewhere — normally what a side input's target is. */
  usedModules: Set<string>;
  /** Did anything route to a sum? One flag per sum, used when the file declares no master run. */
  feedsSum: Record<string, boolean>;
  isChain: (n: string) => boolean;
  isVideoTrack: (n: string) => boolean;
  /** A LANE, of EITHER kind — never followed as a chain, and never drawn as a sink. See docs/graphBuild.md. */
  isLane: (n: string) => boolean;
  /** Is this name one of the two SUMS? Every test that singles one out means both. */
  isSum: (n: string) => boolean;
  /** …and the other end: the two DEVICES the signal leaves by, which `drawMainOut` governs together. */
  isDevice: (n: string) => boolean;
  trackId: (n: string) => string;
  moduleId: (mod: string) => string;
  chainId: (chain: string) => string;
  /** The sum's card — a SINK like `OUT`, whatever the run headed by it is written as. */
  mixId: string;
  /** …and the picture's, which is the same card in every respect the drawing cares about. */
  renderId: string;
  entryId: (chain: string) => string;
  exitId: (chain: string) => string;
  /** Every node is the plain size unless it says otherwise — only a module carrying a UI does. */
  add: (id: string, n: NodeFields) => string;
  /** A destination with no module behind it — a built-in output, or a name the graph cannot account for. */
  addSink: (name: string, extra?: Partial<Omit<RawNode, "id">>) => string;
  /** What the RENDER sum's card carries: the frame's shape as a FIELD, when the host said what it is. */
  renderCard: () => Partial<Omit<RawNode, "id">>;
  /** …and what the MAIN OUTPUT's card carries beyond that: its own fader, absent rather than 0. */
  mainOutCard: () => Partial<Omit<RawNode, "id">>;
  /** Add a connection once — but "once" is per SOCKET, not per pair. See docs/graphBuild.md. */
  link: (
    source: string,
    target: string,
    label?: string,
    signal?: WebSignal,
    targetPort?: string,
    sourcePort?: string,
  ) => void;
  /** What leaves a chain — its last module, or whatever reached a pass-through. */
  exitSignal: (chain: string) => WebSignal | undefined;
}

/** A node's flags all false: what every built-in card starts from. */
export const PLAIN_FLAGS = {
  dim: false,
  missing: false,
  stub: false,
  notSupported: false,
  unknownPlugin: false,
  hasNativePluginUI: false,
} as const;

export function makeBuild(graph: WebGraph, opts: BuildOptions): Build {
  const nodes = new Map<string, RawNode>();
  const edges = new Map<string, RawEdge>();

  const isChain = (n: string) => n in graph.chains;
  const isTrack = (n: string) => graph.tracks.includes(n);
  const isVideoTrack = (n: string) => !!graph.videoTracks?.includes(n);
  const isLane = (n: string) => isTrack(n) || isVideoTrack(n);
  const isSum = (n: string) => n === MIX_OUT || n === RENDER_OUT;
  const isDevice = (n: string) => n === MAIN_OUT || n === VIDEO_OUT;
  const trackId = (n: string) => `trk:${n}`;
  const sinkId = (n: string) => `snk:${n}`;
  const mixId = sinkId(MIX_OUT);
  const renderId = sinkId(RENDER_OUT);
  const moduleId = (mod: string) => `mod:${mod}`;
  const chainId = (chain: string) => `chn:${chain}`;
  // A chain's two ends. A MASTER run holding no module ends on the sum's own card — docs/graphBuild.md.
  const endId = (chain: string, module: string | undefined) =>
    module !== undefined
      ? moduleId(module)
      : chain === MIX_OUT
        ? mixId
        : chain === RENDER_OUT
          ? renderId
          : chainId(chain);
  const entryId = (chain: string) => {
    const u = graph.chains[chain].use;
    return endId(chain, u[0]?.module);
  };
  const exitId = (chain: string) => {
    const u = graph.chains[chain].use;
    return endId(chain, u[u.length - 1]?.module);
  };

  const add = (id: string, n: NodeFields) => {
    if (!nodes.has(id)) nodes.set(id, { id, w: NODE_W, h: NODE_H, ...n });
    else if (n.kind === "module" && n.chains) {
      const existing = nodes.get(id)!;
      const merged = new Set([...(existing.chains ?? []), ...n.chains]);
      existing.chains = [...merged];
      // The sub line names the chains sharing this module, so it must follow the MERGE.
      existing.sub = merged.size > 1 ? [...merged].join(", ") : undefined;
    }
    return id;
  };
  const addSink = (name: string, extra: Partial<Omit<RawNode, "id">> = {}) =>
    add(sinkId(name), {
      label: name,
      kind: "sink",
      ...PLAIN_FLAGS,
      ...extra,
    });
  const renderCard = (): Partial<Omit<RawNode, "id">> => {
    const i = opts.aspect === undefined ? -1 : opts.aspect;
    return i < 0
      ? {}
      : {
          module: RENDER_OUT,
          ui: RENDER_UI,
          aspect: i,
          ...nodeSize(RENDER_UI),
        };
  };
  const mainOutCard = (): Partial<Omit<RawNode, "id">> => ({
    module: MAIN_OUT,
    ui: MAIN_OUT_UI,
    ...(opts.mainOutVolume === undefined
      ? {}
      : { params: { Volume: opts.mainOutVolume } }),
    ...nodeSize(MAIN_OUT_UI),
  });

  const mixerOwner = new Map<string, string>();
  for (const [track, node] of Object.entries(graph.trackMixers ?? {}))
    mixerOwner.set(node, track);

  const pairs = new Map<string, string[]>(); // "a->b" (unordered) -> edge ids on it
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const link: Build["link"] = (
    source,
    target,
    label,
    signal,
    targetPort,
    sourcePort,
  ) => {
    if (source === target) return; // a chain that feeds itself — skip the degenerate self-loop
    const pk = pairKey(source, target);
    const onPair = pairs.get(pk) ?? [];
    // A cable already here that this expression could BE: same source port, or either naming none.
    const existing = onPair
      .map((id) => edges.get(id))
      .find(
        (e) =>
          e !== undefined &&
          (!sourcePort || !e.sourcePort || e.sourcePort === sourcePort),
      );
    if (existing) {
      if (!existing.label && label) existing.label = label;
      if (!existing.signal && signal) existing.signal = signal;
      if (!existing.targetPort && targetPort) existing.targetPort = targetPort;
      if (!existing.sourcePort && sourcePort) existing.sourcePort = sourcePort;
      return;
    }
    // The port is IN the id: two cables between one pair need two, and the renderer keys on it.
    const key = `${source}${sourcePort ? `#${sourcePort}` : ""}->${target}`;
    pairs.set(pk, [...onPair, key]);
    edges.set(key, {
      id: key,
      source,
      target,
      label,
      signal,
      targetPort,
      sourcePort,
    });
  };

  const usedModules = new Set<string>();
  for (const c of Object.values(graph.chains))
    for (const s of c.use) usedModules.add(s.module);

  // `seen` guards the follow through pass-through chains.
  const exitSignal = (
    chain: string,
    seen = new Set<string>(),
  ): WebSignal | undefined => {
    const c = graph.chains[chain];
    if (!c || seen.has(chain)) return undefined;
    seen.add(chain);
    if (c.use.length) return c.use[c.use.length - 1].emits;
    if (!c.from) return undefined;
    // A run out of a SUM is answered BY NAME — following `from` re-enters this chain. docs/graphBuild.md.
    if (isSum(c.from)) return c.from === RENDER_OUT ? "video" : "audio";
    // A run that left a lane by a named output carries that output's signal, whatever the lane holds.
    if (c.fromPort === "midi" || c.fromPort === "audio") return c.fromPort;
    if (isChain(c.from) && !isLane(c.from)) return exitSignal(c.from, seen);
    // A picture lane carries one signal and has no `trackSignals` entry — picture is the other compile's.
    return isVideoTrack(c.from) ? "video" : graph.trackSignals?.[c.from];
  };

  return {
    graph,
    opts,
    nodes,
    edges,
    boundCurves: new Set<string>(),
    moduleRank: new Map<string, number>(),
    mixerOwner,
    clipSpan: clipSpanOf(graph),
    usedModules,
    feedsSum: { [MIX_OUT]: false, [RENDER_OUT]: false },
    isChain,
    isVideoTrack,
    isLane,
    isSum,
    isDevice,
    trackId,
    moduleId,
    chainId,
    mixId,
    renderId,
    entryId,
    exitId,
    add,
    addSink,
    renderCard,
    mainOutCard,
    link,
    exitSignal: (chain) => exitSignal(chain),
  };
}
