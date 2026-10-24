// buildChains.ts — the steps of `buildGraph` that turn the document into cards and cables: each
// chain's modules in series with the curves bound to them, where a chain starts and where it goes,
// a rack's tap feeds, the sums, and the lanes and curves nothing routes. Each step writes through
// the run's `Build`. See docs/graphBuild.md.

import {
  splitPort,
  TRACK_OUTPUTS,
  type WebChain,
  type WebChainStep,
  type WebCurve,
  type WebModuleUI,
} from "@studio/graph-model";
import { panelWidgets } from "@studio/graph-model/panel";
import { depthOf } from "./automationDepth";
import { type Build, PLAIN_FLAGS } from "./buildContext";
import {
  clipsOf,
  columnW,
  MAIN_OUT,
  MIX_OUT,
  menuH,
  nodeSize,
  noteOf,
  RENDER_OUT,
  VIDEO_OUT,
  widgetRect,
} from "./geometry";
import { carryStep, type Pt } from "./graphNode";
import { stepUI, TRACK_UI, VIDEO_TRACK_UI } from "./nodeUIs";

// The node-local centre of the widget bound to `param` — where an automation arrow lands.
function widgetCenter(
  ui: WebModuleUI | undefined,
  param: string,
): Pt | undefined {
  for (const [, w] of panelWidgets(ui)) {
    if (w.bind === param) {
      const r = widgetRect(w, columnW(ui), menuH(ui));
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }
  }
  return undefined;
}

/** Whether a node's events fire this curve: an envelope always, any other when one of its conditions is an event. */
function firedByEvent(curve: WebCurve): boolean {
  if (curve.type === "adsr") return true;
  return !!curve.spec?.conditions?.some((c) => c.type === "event");
}

// A curve node's secondary line: the kind, plus the LFO shape. ASCII only — the BitmapText atlas.
function curveSubLabel(curve: WebCurve): string {
  if (curve.type === "lfo") return `lfo ${curve.shape ?? "sine"}`;
  // An envelope says so rather than borrowing "custom": it is the one curve with an event socket.
  return curve.type === "adsr" ? "adsr" : "custom";
}

/** A chain's modules, in series, each with its bound curves. */
export function addChainModules(b: Build, name: string, c: WebChain): void {
  const { graph, opts, nodes, edges, moduleId } = b;
  const chainOn = c.enabled !== false;
  c.use.forEach((s, i) => {
    const mid = moduleId(s.module);
    const existing = nodes.get(mid);
    // When the same module appears in multiple chains, merge into one node.
    const chains = existing?.chains
      ? [...new Set([...existing.chains, name])]
      : [name];
    // Read once: the node's panel and the node's size are the same answer.
    const ui = stepUI(s, opts.inputDevices, opts.cameras, opts.midiDevices);
    b.add(mid, {
      label: s.module,
      // Only the SHARED case earns a sub line: editing this module reaches more than one chain. See docs/graphBuild.md.
      sub: chains.length > 1 ? chains.join(", ") : undefined,
      kind: "module",
      chain: chains[0],
      chains,
      dim: !chainOn || s.enabled === false,
      // Distinct from `dim`, which also covers a whole chain: this is THIS step's bypass.
      bypassed: s.enabled === false,
      module: s.module,
      // A lane's FADER wears that lane's face — its glyph and its name — since a strip is what a track's level became.
      ...(b.mixerOwner.get(s.module)
        ? { trackFace: b.mixerOwner.get(s.module) }
        : {}),
      // …and whether it is inside somebody's render — one map answers for a lane and a module alike.
      ...(graph.frozen?.[s.module] ? { frozen: graph.frozen[s.module] } : {}),
      ...(graph.autoFrozen?.[s.module]
        ? { autoFrozen: graph.autoFrozen[s.module] }
        : {}),
      // Everything the step itself says, in one move — see CARRIED/FLAGS.
      ...carryStep(s),
      // The panel the node actually DRAWS, over the raw one `carryStep` brought — docs/graphBuild.md.
      ui,
      // As big as its grid needs, and the bottom bar under it — but a strip, which has neither stage nor sets, draws none.
      ...nodeSize(ui, !s.strip),
      // …and a NOTE is as big as its text, which overrides that: a note has no widget grid.
      ...noteOf(graph, s.module),
    });
    // Track the maximum position this module occupies across all chains.
    b.moduleRank.set(mid, Math.max(b.moduleRank.get(mid) ?? 0, i));
    if (i > 0) {
      const prev = c.use[i - 1];
      const prevId = moduleId(prev.module);
      // The cable between two modules carries what the UPSTREAM one emits.
      b.link(prevId, mid, undefined, prev.emits);
      // Within-chain series edges get a higher weight so dagre keeps them tight.
      const e = edges.get(`${prevId}->${mid}`);
      if (e) e.weight = (e.weight ?? 1) + 4;
    }
    addBoundCurves(b, s);
  });
}

// One curve node PER BINDING, the id carrying it — see docs/graphBuild.md.
function addBoundCurves(b: Build, s: WebChainStep): void {
  const { graph, edges, moduleId } = b;
  for (const a of s.automations ?? []) {
    const curve = graph.curves?.[a.curve];
    if (!curve) continue; // the curve was dropped (missing file) — nothing to draw
    b.boundCurves.add(a.curve);
    const cid = `crv:${a.curve}@${s.module}:${a.param}`;
    b.add(cid, {
      label: a.curve,
      sub: curveSubLabel(curve),
      kind: "curve",
      // An envelope, or a curve an event condition starts: what fires it plugs in here.
      eventIn: firedByEvent(curve),
      curveOf: { curve: a.curve, module: s.module, param: a.param },
      ...(curve.spec ? { curveSpec: curve.spec } : {}),
      ...PLAIN_FLAGS,
    });
    // The node id already names the binding, so the edge key is just its two ends.
    const key = `${cid}->${moduleId(s.module)}`;
    edges.set(key, {
      id: key,
      source: cid,
      target: moduleId(s.module),
      automation: {
        param: a.param,
        widget: widgetCenter(s.ui, a.param),
        ...(depthOf(curve) ? { depth: depthOf(curve) } : {}),
      },
    });
    // …and the cable that FIRES it, for an envelope or an event condition — the same `trigger` the compiler reads.
    if (firedByEvent(curve)) {
      const from = moduleId(a.trigger ?? s.module);
      const ek = `ev:${from}->${cid}`;
      edges.set(ek, {
        id: ek,
        source: from,
        target: cid,
        signal: "event",
        sourcePort: "note-on",
      });
    }
  }
}

/** A lane's card, the strip of its kind; a routed lane also sizes to the clips it holds. */
function laneCard(b: Build, lane: string, withClips: boolean) {
  const { graph } = b;
  const video = b.isVideoTrack(lane);
  const ui = video ? VIDEO_TRACK_UI : TRACK_UI;
  return {
    label: lane,
    kind: "track" as const,
    video,
    // The two outputs a lane offers, audio first — a picture lane's are its picture and its shots' sound.
    outputs: video
      ? [
          { name: "video", type: "video" as const },
          { name: "audio", type: "audio" as const },
        ]
      : TRACK_OUTPUTS.map((o) => ({ ...o })),
    color: graph.trackColors?.[lane],
    // A lane is a module node, so it is addressable like one — packages/song/docs/alternatives.md.
    module: lane,
    ...(graph.trackAlternatives?.[lane] ?? {}),
    ...(graph.frozen?.[lane] ? { frozen: graph.frozen[lane] } : {}),
    ...(graph.autoFrozen?.[lane] ? { autoFrozen: graph.autoFrozen[lane] } : {}),
    ...PLAIN_FLAGS,
    ui, // the mixer controls; values arrive via setTrackControls
    ...nodeSize(ui), // grow the node to fit its grid
    // …and again to fit what the lane HOLDS — see docs/graphBuild.md.
    ...(withClips ? clipsOf(graph, lane, nodeSize(ui), b.clipSpan) : {}),
  };
}

/** Where a chain starts: a pass-through card when it holds nothing, then the cable from its `from`. */
export function addChainSource(b: Build, name: string, c: WebChain): void {
  const { graph, isSum, isChain, isLane, entryId } = b;
  // A pass-through card for a chain holding no module — except either MASTER run, whose ends are cards already.
  if (!c.use.length && !isSum(name))
    b.add(b.chainId(name), {
      label: name,
      kind: "chain",
      chain: name,
      ...PLAIN_FLAGS,
      dim: c.enabled === false,
    });

  // A `from` is chain-feeds-chain only when it names a DIFFERENT chain and not a track. See docs/graphBuild.md.
  if (!c.from) return;
  // The MASTER run starts at a SUM, which is a built-in output and not a lane — docs/graphBuild.md.
  if (isSum(c.from))
    b.link(
      b.addSink(c.from),
      entryId(name),
      undefined,
      c.from === RENDER_OUT ? "video" : "audio",
    );
  else if (c.from !== name && isChain(c.from) && !isLane(c.from))
    b.link(b.exitId(c.from), entryId(name), undefined, b.exitSignal(c.from));
  else {
    const video = b.isVideoTrack(c.from);
    b.add(b.trackId(c.from), laneCard(b, c.from, true));
    // What the cable carries AND which jack it leaves by: `fromPort` is both. See docs/graphBuild.md.
    const port = c.fromPort;
    b.link(
      b.trackId(c.from),
      entryId(name),
      undefined,
      video
        ? "video"
        : port === "midi"
          ? "midi"
          : port === "audio"
            ? "audio"
            : (graph.trackSignals?.[c.from] ?? "audio"),
      undefined,
      port,
    );
  }
}

/** Where a chain goes: its exit cabled to each target — another chain's entry, a module, or a sink. */
export function addChainOutputs(b: Build, name: string, c: WebChain): void {
  const { isSum, isLane, isChain } = b;
  for (const o of c.out) {
    // A destination may name a PORT (`crossfade#b`), split off before any test below or it invents a sink.
    const { node: toNode, port: toPort } = splitPort(o.to);
    // A cable into MIX is never drawn, RENDER's are — the reasons are docs/graphBuild.md's.
    if (isSum(toNode)) {
      b.feedsSum[toNode] = true;
      if (toNode !== RENDER_OUT) continue;
    }
    // A host may ask for the DEVICES to be left out entirely — see `drawMainOut`.
    if (b.isDevice(toNode) && b.opts.drawMainOut === false) continue;
    // …and when OUT is drawn it carries its own fader; `VIDEO_OUT` has no param, so it draws bare.
    const mainOut = toNode === MAIN_OUT ? b.mainOutCard() : {};
    // A module that is a STEP in someone else's chain — a side input's usual target — has its node already.
    const to = isLane(toNode)
      ? b.trackId(toNode)
      : isChain(toNode)
        ? b.entryId(toNode)
        : b.usedModules.has(toNode)
          ? b.moduleId(toNode)
          : b.addSink(toNode, mainOut);
    b.link(
      b.exitId(name),
      to,
      o.gain !== 1 ? `${Math.round(o.gain * 100)}%` : undefined,
      b.exitSignal(name),
      toPort,
      o.fromPort,
    );
  }
}

// A rack's taps routed to subchains: each a cable from an output of its own, named after the tap (song docs/racks.md).
export function addTapFeeds(b: Build): void {
  for (const f of b.graph.tapFeeds ?? []) {
    const src = b.nodes.get(b.moduleId(f.node));
    const dst = b.isChain(f.to) ? b.entryId(f.to) : b.moduleId(f.to);
    if (!src || !b.nodes.has(dst)) continue;
    const outs = src.outputs?.length
      ? src.outputs
      : [{ name: "out", type: "audio" as const }];
    if (!outs.some((o) => o.name === f.tap))
      src.outputs = [...outs, { name: f.tap, type: "audio" }];
    b.link(src.id, dst, f.tap, "audio", undefined, f.tap);
  }
}

/** Each sum and the wire out of it, when the file declares no master run. See docs/graphBuild.md. */
export function addSums(b: Build): void {
  for (const sum of [MIX_OUT, RENDER_OUT] as const) {
    if (!b.feedsSum[sum] || b.isChain(sum)) continue;
    const card = b.addSink(sum);
    if (b.opts.drawMainOut === false) continue;
    const video = sum === RENDER_OUT;
    b.link(
      card,
      video ? b.addSink(VIDEO_OUT) : b.addSink(MAIN_OUT, b.mainOutCard()),
      undefined,
      video ? "video" : "audio",
    );
  }
  // The RENDER sink wears the FRAME's shape wherever it came from: `add` is first-write-wins, so it is applied here (docs/graphBuild.md).
  const renderSink = b.nodes.get(b.renderId);
  if (renderSink) Object.assign(renderSink, b.renderCard());
}

// Tracks (and video lanes) no chain mentions, drawn as ORPHANS — the missing cable IS the mark. See docs/graphBuild.md.
export function addOrphanLanes(b: Build): void {
  const { graph } = b;
  for (const id of [...graph.tracks, ...(graph.videoTracks ?? [])]) {
    const nid = b.trackId(id);
    if (b.nodes.has(nid)) continue; // a chain already claimed it
    b.add(nid, laneCard(b, id, false));
  }
}

/** The curves nothing binds — one free card each, their ids carrying no binding. See docs/graphBuild.md. */
export function addFreeCurves(b: Build): void {
  for (const [id, curve] of Object.entries(b.graph.curves ?? {}))
    if (!b.boundCurves.has(id))
      b.add(`crv:${id}`, {
        label: id,
        sub: curveSubLabel(curve),
        kind: "curve",
        eventIn: firedByEvent(curve),
        // No module or param: this card is bound to nothing, which is what makes it free.
        curveOf: { curve: id },
        ...(curve.spec ? { curveSpec: curve.spec } : {}),
        ...PLAIN_FLAGS,
      });
}
