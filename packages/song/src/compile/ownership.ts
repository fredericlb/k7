// compile/ownership.ts — which engine track each chain's steps land on: its lane, a bus
// return, the master, a lane-less live input, or the run a routed tap feeds. What a reader gets
// wrong: all four of the owned kinds are named after the CHAIN, not after a lane.
// Part of nodeProject.ts's compile — docs/nodeProject.md.

import {
  CUE_NODE,
  isBuiltinOutput,
  MASTER_OWNER,
  MIX_NODE,
  OUT_NODE,
} from "@studio/song-schema/moduleTypes";
import { type Chain, inputLandingTrack } from "../graph";
import { resolveCueOutput } from "../preferences";
import type { CompileInputs } from "./inputs";

/** Which track every chain contributes to, and the runs that own a track of their own. */
export type ChainOwnership = ReturnType<typeof chainOwnership>;

/** A track-fed chain processes its track; another used as a send target becomes a bus return. See docs/nodeProject.md. */
export function chainOwnership(inp: CompileInputs) {
  const { prefs, chains, lanesMap, videoLanes, modulesMap, routedTaps } = inp;
  const outTargets = (c: Chain): { to: string; gain: number }[] => c.out;
  // The five built-in outputs end a run by NAME; without them a run ending at VIDEO_OUT is taken for a bus.
  const isSink = (to: string) =>
    !to || isBuiltinOutput(to) || modulesMap[to]?.kind === "io";
  const isTrackFed = (c: Chain) => !!c.from && !!lanesMap[c.from];

  // The MASTER chain: the run between the mixer's sum and the device, which earns a reserved owner (docs/masterChain.md).
  const isMasterChain = (c: Chain): boolean =>
    c.from === MIX_NODE && outTargets(c).some(({ to }) => to === OUT_NODE);

  // The CUE bus: the one run that leaves the mixer's sum for a pair of its own — see docs/cue.md.
  const cuePair = resolveCueOutput(prefs).channels;
  const isCued = (c: Chain): boolean =>
    outTargets(c).some(({ to }) => to === CUE_NODE);

  // Non-sink targets naming a chain that isn't track-fed: routing into a track's input is inexpressible, so they drop.
  const busChains = new Set<string>();
  // A PICTURE lane is never a bus, though a fade's stretch routes into its run (song-video/docs/transitions.md).
  for (const c of Object.values(chains))
    for (const { to } of outTargets(c))
      if (
        !isSink(to) &&
        chains[to] &&
        !isTrackFed(chains[to]) &&
        !(to in videoLanes)
      )
        busChains.add(to);

  /** A run carrying a LIVE INPUT and landing on no lane owns its own track.
   *
   * The engine assigns an input to a TRACK and to nothing else, so a rig with no lane authored —
   * `IN -> fader -> OUT` — would otherwise hand its input nowhere and play silence. It is the same
   * materialisation a BUS gets, for the same reason: the document names a run, and the engine's
   * model needs a strip. See docs/liveProject.md. */
  const carriesLiveInput = (c: Chain): boolean =>
    c.use.some((s) => modulesMap[s?.module]?.io === "in");
  const inputChains = new Set<string>();
  for (const [name, c] of Object.entries(chains)) {
    if (isMasterChain(c) || isTrackFed(c) || busChains.has(name)) continue;
    if (!carriesLiveInput(c)) continue;
    // …unless it DOES land on a lane, which is the ordinary recording shape and already works.
    if (inputLandingTrack(c, (id) => !!lanesMap[id])) continue;
    inputChains.add(name);
  }

  // A run fed by a routed tap owns a track too: the instrument's pair is returned at its front (docs/racks.md).
  const tapChains = new Map<string, { node: string; pair: number }>();
  for (const list of routedTaps.values())
    for (const t of list) {
      const run = Object.entries(chains).find(
        ([, c]) => !c.from && c.use[0]?.module === t.to,
      );
      if (run) tapChains.set(run[0], { node: t.node, pair: t.pair });
    }
  // …and every tap a node routes must have reached one: a subchain that does not exist would swallow it silently.
  for (const [node, m] of Object.entries(modulesMap)) {
    const outs = (m as { tap_outs?: Record<string, string> } | undefined)
      ?.tap_outs;
    for (const [tap, sub] of Object.entries(outs ?? {}))
      if (!routedTaps.get(node)?.some((t) => t.tap === tap))
        throw new Error(
          `node '${node}': tap '${tap}' is routed to '${sub}', which is not a subchain of its chain file`,
        );
  }
  // The track id a chain contributes to: its source track, its own bus track, its own INPUT
  // track, or the track a tap feeds — all four being the chain's own NAME.
  const ownerOf = (name: string, c: Chain): string =>
    isMasterChain(c)
      ? MASTER_OWNER
      : isTrackFed(c) ||
          busChains.has(name) ||
          inputChains.has(name) ||
          tapChains.has(name)
        ? name
        : "";

  // The TRACK a step's side input comes from, put through the same ownership rule the plugins are (docs/ports.md).
  const sideInputTrack = (id: string): string => {
    const c = chains[id];
    if (c) return ownerOf(id, c);
    if (lanesMap[id]) return id;
    // …and a STEP in the middle of a run, whose signal is its chain's — one level deeper, same rule (docs/graphModel.md).
    for (const [name, chain] of Object.entries(chains))
      if (chain.use.some((s) => s?.module === id)) return ownerOf(name, chain);
    return "";
  };

  return {
    outTargets,
    isCued,
    cuePair,
    busChains,
    inputChains,
    tapChains,
    ownerOf,
    sideInputTrack,
  };
}
