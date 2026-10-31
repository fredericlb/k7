// graphValidate.ts — what a GraphDoc is checked for: each module's ports fed as declared, and the
// warnings validate() raises over the whole graph (dangling refs, cycles, unreachable sinks).
// What a reader gets wrong: a port mismatch THROWS, the rest only warns. See docs/graphModel.md.

import type { GraphIssue } from "@studio/graph-model";
import {
  MIX_NODE,
  portRef,
  RENDER_NODE,
  splitPort,
  TRANSITION_CATEGORY,
} from "@studio/song-schema/moduleTypes";
import { isParked } from "./chainsGraph";
import {
  type Chain,
  carriesCamera,
  carriesInput,
  carriesMidiIn,
  carriesShape,
  chainAt,
  type GraphDoc,
  inputLandingTrack,
  isCameraModule,
  isInputModule,
  isMidiInModule,
  isNode,
  isSink,
  isStretch,
  nodeHint,
  normalizeInputs,
  sourceType,
} from "./graphTypes";
import { issue } from "./graphWarnings";
import type {
  LoadedModule,
  RawClip,
  RawSequence,
  RawVideoTrack,
} from "./rawDoc";
import type { Lane } from "./trackModule";

// Every chain must feed each module the input ports its type declares; a non-empty result is FATAL (docs/graphModel.md).
export function checkChainInputs(
  // Already parsed and keyed by resolved name (see parseChains) — not the raw export.
  parsed: Record<string, Chain>,
  modules: Record<string, LoadedModule>,
  lanes: Record<string, Lane>,
  clips: Record<string, RawClip>,
  seqs: Record<string, RawSequence>,
  // The picture lanes (`@meta/picture-track` nodes): a chain sourced from one types as "video".
  videoTracks: Record<string, RawVideoTrack> = {},
  // The first nodes of runs a rack's TAP feeds: fed with audio, though no edge says so (docs/racks.md).
  tapFed: ReadonlySet<string> = new Set(),
): string[] {
  const errs: string[] = [];

  // Chains routed into by another chain's `out`, so their first module has a flow even without a `from`.
  const routedInto = new Set<string>();
  for (const c of Object.values(parsed))
    for (const o of c.out) routedInto.add(o.to);

  for (const [chainName, c] of Object.entries(parsed)) {
    if (isParked(c)) continue; // placed, not wired yet — nothing to check the ports of
    // A group carries no signal, and the compiler would drop this chain's plugins silently — see docs/graphModel.md.
    if (c.from && lanes?.[c.from]?.type === "group")
      errs.push(
        `chain '${chainName}': from '${c.from}' is a group — groups carry no signal; name a member track`,
      );

    const steps = c.use;
    steps.forEach((step, idx) => {
      if (step?.enabled === false) return; // a bypassed step passes signal through untouched
      const module = modules?.[step?.module];
      if (!module) return; // a missing module is reported by validate()
      const inputs = normalizeInputs(module.inputs);
      if (!inputs.length) return; // opts out of input checking

      // Sources feeding this step in port order, each with its resolved type or undefined when unknowable.
      const tapped = idx === 0 && tapFed.has(step.module);
      // A STRETCH's head is fed by the shot its fade runs on, which no edge says (song-video/docs/transitions.md).
      const shot =
        idx === 0 &&
        !c.from &&
        !routedInto.has(chainName) &&
        inputs[0]?.type === "video" &&
        c.out.some((o) => !!videoTracks[splitPort(o.to).node]);
      const hasFlow =
        idx > 0 ||
        (idx === 0 &&
          (!!c.from || routedInto.has(chainName) || tapped || shot));
      const sources: {
        id: string;
        type: "audio" | "midi" | "video" | undefined;
      }[] = [];
      if (hasFlow)
        sources.push(
          idx === 0 && c.from
            ? {
                // With the port when the run left by one: a detyped lane's own address says what it carries.
                id: c.fromPort
                  ? portRef(String(c.from), c.fromPort)
                  : String(c.from),
                type: sourceType(
                  c.fromPort
                    ? portRef(String(c.from), c.fromPort)
                    : String(c.from),
                  lanes,
                  clips,
                  seqs,
                  videoTracks,
                ),
              }
            : tapped
              ? { id: "(tap)", type: "audio" }
              : shot
                ? { id: "(shot)", type: "video" }
                : { id: "(flow)", type: undefined },
        );
      for (const s of Array.isArray(step.in) ? step.in : [])
        sources.push({
          id: String(s),
          type: sourceType(String(s), lanes, clips, seqs, videoTracks),
        });

      const where = `chain '${chainName}' step ${idx + 1} (module '${step.module}')`;
      const mandatory = inputs.filter((i) => i.mandatory).length;
      if (sources.length < mandatory)
        errs.push(
          `${where}: feeds ${sources.length} input(s) but ${mandatory} mandatory port(s) required`,
        );
      else if (sources.length > inputs.length)
        errs.push(
          `${where}: feeds ${sources.length} input(s) but the module has only ${inputs.length} port(s)`,
        );

      // Positional type check, where the source's type is knowable.
      inputs.forEach((inp, i) => {
        const src = sources[i];
        if (!src || src.type === undefined) return;
        if (src.type !== inp.type)
          errs.push(
            `${where}: port '${inp.name}' expects ${inp.type} but source '${src.id}' is ${src.type}`,
          );
      });
    });
  }
  return errs;
}

/** validate()'s warnings as sentences — what a log, the CLI and `GraphDoc.warnings` carry. */
export function validate(g: GraphDoc): string[] {
  return validateIssues(g).map((i) => i.text);
}

/** …and as codes with their names, so a screen can word each one itself (graphWarnings.ts). */
export function validateIssues(g: GraphDoc): GraphIssue[] {
  const w: GraphIssue[] = [];
  // Tracks on disk but left out of `g.tracks` for being disabled, so a lookup miss can be told from a typo.
  const disabled = new Set(g.disabledTracks);

  for (const [name, c] of Object.entries(g.chains)) {
    // `from` may name a track, a video track or ANOTHER chain, never this one; MIX and RENDER are exempt (docs/graphModel.md).
    if (
      c.from &&
      c.from !== MIX_NODE &&
      c.from !== RENDER_NODE &&
      !g.tracks[c.from] &&
      !g.videoTracks[c.from] &&
      !(c.from !== name && g.chains[c.from])
    )
      w.push(issue("chainFromUnknown", { chain: name, from: c.from }));
    // A DETYPED lane holding both kinds, running down one chain that expects one of them — see docs/graphModel.md.
    if (c.from && !c.fromPort && c.use.length) {
      const lane = g.tracks[c.from];
      const kinds = new Set((lane?.placements ?? []).map((p) => p.kind));
      const wants = g.modules[c.use[0].module]?.inputs?.[0]?.type;
      if (
        kinds.has("audio") &&
        kinds.has("midi") &&
        (wants === "audio" || wants === "midi")
      )
        w.push(
          issue("chainMixedLane", {
            chain: name,
            track: c.from,
            module: c.use[0].module,
            wants,
          }),
        );
    }
    for (const s of c.use) {
      const module = g.modules[s.module];
      if (!module)
        w.push(
          issue("chainStepUnknown", {
            chain: name,
            module: s.module,
            hint: nodeHint(g, s.module),
          }),
        );
      else if (module.extends && !g.moduleRefs[module.extends])
        w.push(
          issue("chainExtendsUnknown", {
            chain: name,
            module: s.module,
            base: module.extends,
          }),
        );
      // A transition is named by a cut, never wired; its empty `inputs` means unconstrained — song-video/docs/transitions.md.
      else if (module.category === TRANSITION_CATEGORY)
        w.push(
          issue("chainTransitionWired", { chain: name, module: s.module }),
        );
    }
    for (const o of c.out) {
      // A destination may name a PORT (`crossfade#b`), so the jack comes off first; only the last `#` is the port.
      const { node: to } = splitPort(o.to);
      const target = g.modules[to];
      // Routing INTO a live input is meaningless, and is checked ahead of isNode, which says yes (docs/graphModel.md).
      if (target && isInputModule(g, target))
        w.push(issue("outIsInput", { chain: name, out: o.to }));
      // …and the same about a lens, which is the other thing signal only ever comes out of.
      else if (target && isCameraModule(target))
        w.push(issue("outIsCamera", { chain: name, out: o.to }));
      // …and a MIDI device, the third: notes come FROM a keyboard, never to one.
      else if (target && isMidiInModule(target))
        w.push(issue("outIsMidiDevice", { chain: name, out: o.to }));
      // A picture lane takes only a camera, a shape or a fade's stretch; anything else is dropped — docs/camera.md.
      else if (g.videoTracks[to]) {
        if (!carriesCamera(g, c) && !carriesShape(g, c) && !isStretch(g, c))
          w.push(issue("outIsPictureLane", { chain: name, out: o.to }));
      }
      // Only a live input's signal may land on a LANE; anything else aimed at one is silently discarded.
      else if (g.tracks[to] || disabled.has(to)) {
        // A MIDI device lands on a lane too: it says what that lane RECORDS from (docs/midiIn.md).
        if (!carriesInput(g, c) && !carriesMidiIn(g, c))
          w.push(issue("outIsTrack", { chain: name, out: o.to }));
      }
      // A camera may land on no picture lane, since it draws a layer of its own — docs/camera.md.
      else if (!isNode(g, o.to) && !carriesCamera(g, c))
        w.push(issue("outUnknown", { chain: name, out: o.to }));
      if (o.gain < 0)
        w.push(issue("outNegativeGain", { chain: name, out: o.to }));
      // …and which output it LEFT from — see docs/graphModel.md.
      if (o.fromPort) {
        const src = c.use.length ? c.use[c.use.length - 1].module : c.from;
        const srcModule = src ? g.modules[src] : undefined;
        if (srcModule && !srcModule.outputs.some((p) => p.name === o.fromPort))
          w.push(
            issue("outBadPort", {
              chain: name,
              out: o.to,
              source: src ?? "",
              port: o.fromPort,
              outputs: srcModule.outputs.map((p) => p.name).join(", "),
            }),
          );
      }
    }
    if (!c.out.length && !isParked(c))
      w.push(issue("chainDeadEnd", { chain: name }));
  }

  for (const [id, t] of Object.entries(g.tracks))
    for (const p of t.placements)
      if (p.kind === "missing")
        w.push(issue("trackClipMissing", { track: id, ref: p.ref }));

  // A module naming a file its own assets/ doesn't hold: `nam` and `assets` disagreeing IS the report (docs/graphModel.md).
  for (const [name, b] of Object.entries(g.modules))
    for (const [param, ref] of Object.entries(b.assets ?? {}))
      if (!(b as unknown as Record<string, unknown>)[param])
        w.push(
          issue("moduleAssetMissing", {
            module: name,
            param,
            ref: String(ref),
          }),
        );

  // Live-input modules, walked over the CHAINS because an input is wired by the run it sits in (docs/graphModel.md).
  const fedBy = new Map<string, string>();
  for (const [_chainName, c] of Object.entries(g.chains)) {
    if (isParked(c)) continue; // an input dropped in but not wired yet lands nowhere, by design
    for (const s of c.use) {
      const b = g.modules[s.module];
      if (!b || !isInputModule(g, b)) continue;
      if (b.channel == null)
        w.push(issue("inputNoChannel", { input: s.module }));
      const track = inputLandingTrack(
        c,
        (id) => !!g.tracks[id] || disabled.has(id),
      );
      // No lane is no fault: an input run materialises its own track, so there is nothing to check (docs/liveProject.md).
      if (!track) continue;
      const target = g.tracks[track];
      if (!target)
        // Disabled reads as absent here, so say which it is rather than send the reader hunting for a typo.
        w.push(
          issue(
            disabled.has(track) ? "inputTrackDisabled" : "inputTrackMissing",
            { input: s.module, track },
          ),
        );
      else if (target.type === "group")
        w.push(issue("inputTrackGroup", { input: s.module, track }));
      else if (target.type === "strudel")
        w.push(issue("inputTrackStrudel", { input: s.module, track }));
      // The engine assigns ONE input per track, so name both rather than let the last one loaded silently win.
      const prev = fedBy.get(track);
      if (prev)
        w.push(
          issue("trackTwoInputs", { track, first: prev, second: s.module }),
        );
      else fedBy.set(track, s.module);
    }
  }
  // `channel` anywhere else is silently ignored, which looks like it took effect.
  for (const [name, b] of Object.entries(g.modules))
    if (!isInputModule(g, b) && b.channel != null)
      w.push(issue("moduleChannelNotInput", { module: name }));

  // Group membership: a member must exist, must not be the group itself, and must belong to only one group.
  const claimed = new Map<string, string>();
  for (const [id, t] of Object.entries(g.tracks)) {
    if (t.type !== "group") continue;
    for (const m of t.tracks) {
      if (m === id) w.push(issue("groupContainsItself", { group: id }));
      // A disabled member is deliberate; only a member that exists nowhere is worth a warning.
      else if (!g.tracks[m] && !disabled.has(m))
        w.push(issue("groupTrackMissing", { group: id, track: m }));
      const owner = claimed.get(m);
      if (owner)
        w.push(issue("trackTwoGroups", { track: m, first: owner, second: id }));
      else claimed.set(m, id);
    }
  }

  // Assembly membership: the same three questions a group's is, over any node rather than over lanes.
  const inBox = new Map<string, string>();
  for (const [id, a] of Object.entries(g.assemblies)) {
    // One flat key space: a box drawn under a name a chain step already spells is two things called one word.
    if (g.modules[id] || g.tracks[id])
      w.push(issue("assemblyNameTaken", { assembly: id }));
    for (const [member, node] of Object.entries(a.members)) {
      if (!g.modules[node] && !g.tracks[node] && !disabled.has(node))
        w.push(issue("assemblyMemberMissing", { assembly: id, member, node }));
      const owner = inBox.get(node);
      if (owner)
        w.push(issue("nodeTwoAssemblies", { node, first: owner, second: id }));
      else inBox.set(node, id);
    }
  }

  // Every source chain (has a track input) should reach a sink.
  for (const [name, c] of Object.entries(g.chains))
    if (c.from && !reachesSink(g, name, new Set()))
      w.push(issue("chainNoOut", { chain: name }));

  // Cycle check over chain→chain edges.
  for (const name of Object.keys(g.chains))
    if (hasCycle(g, name, new Set(), new Set())) {
      w.push(issue("chainCycle", { chain: name }));
      break;
    }

  return w;
}

function reachesSink(g: GraphDoc, name: string, seen: Set<string>): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const c = g.chains[name];
  if (!c) return false;
  return c.out.some((o) => {
    if (isSink(g, splitPort(o.to).node)) return true;
    // A side input lands on a step inside ANOTHER run, so the walk continues there — see docs/graphModel.md.
    const next = chainAt(g, o.to);
    return !!next && reachesSink(g, next, seen);
  });
}

function hasCycle(
  g: GraphDoc,
  name: string,
  stack: Set<string>,
  done: Set<string>,
): boolean {
  if (stack.has(name)) return true;
  if (done.has(name) || !g.chains[name]) return false;
  stack.add(name);
  const cycle = g.chains[name].out.some((o) => {
    // Through a port too: a loop drawn with side inputs is exactly as unplayable as one drawn with bare ones.
    const next = chainAt(g, o.to);
    return !!next && hasCycle(g, next, stack, done);
  });
  stack.delete(name);
  done.add(name);
  return cycle;
}
