// nodeProject.ts — compile a chains/modules node project (a graph) into the flat
// tracks-with-clips-and-plugins ProjectDoc the engine plays: each track becomes a lane,
// each chain's `use` steps become that track's plugins in order. The stages live in compile/.
// Full rationale: docs/nodeProject.md.

import { MASTER_OWNER } from "@studio/song-schema/moduleTypes";
import { materialRefOf, placementId } from "@studio/song-schema/placementId";
import { autoColors } from "@studio/song-schema/trackColor";
import { orderTracks, trackCategory } from "@studio/song-schema/trackKind";
import { type AutoFreeze, autoFreezes, playsRender } from "./autoFreeze";
import { isChainProject, readChainProject } from "./chainProject";
import { compClips, markCrossfades } from "./compClips";
import { placementToClip } from "./compile/clips";
import { freezePoints, frozenClip } from "./compile/freeze";
import {
  checkReferences,
  liveInputsOf,
  loadCompileInputs,
} from "./compile/inputs";
import { chainOwnership } from "./compile/ownership";
import { bakeAutomations, compilePlugins } from "./compile/plugins";
import { withConsole } from "./console";
import {
  isPatternLane,
  patternPlugins,
  patternShares,
  sampleBanks,
} from "./enginePattern";
import { loadGraph } from "./graph";
import { highlighted } from "./highlight";
import { loadSettings, loadVideoTracks } from "./loader";
import { withModuleStamp } from "./moduleCache";
import type {
  ClipDoc,
  GroupDoc,
  PluginDoc,
  ProjectDoc,
  TrackDoc,
} from "./project";
import { parseMarkers, parseSettings } from "./project";
import type { RawPlacement } from "./rawDoc";
import type { Material } from "./trackModule";
import { videoSoundLanes } from "./videoSound";

export { FROZEN_CLIP_SUFFIX, isFrozenClipId } from "./compile/freeze";
// Re-exported from @studio/song-schema, and imported too because `export … from` binds no local name (docs/graphModel.md).
export { materialRefOf, placementId };

// A compile READS the project, so one walk of the module folders covers however often it asks the cache (moduleCache.ts).
export function compileNodeProject(dir: string): ProjectDoc {
  return compileWithAutoFreezes(dir).doc;
}

/**
 * The compile in two passes when the song has VSTs (docs/autoFreeze.md): LIVE first, since an
 * automatic freeze is fingerprinted from what it would replace, then again with every automatic
 * freeze whose render is on disk standing in for its modules. Also answers the freezes themselves,
 * ready or not, for whoever schedules the missing renders.
 */
export function compileWithAutoFreezes(
  dir: string,
  /** `vsts: "none"` compiles for an engine that hosts no VST — a share's, the server's (docs/autoFreeze.md). */
  opts: { vsts?: "scan" | "none" } = {},
): {
  doc: ProjectDoc;
  freezes: AutoFreeze[];
} {
  return withModuleStamp(dir, () => {
    const live = compileNodeProjectIn(dir);
    let freezes: AutoFreeze[];
    try {
      freezes = autoFreezes(dir, loadGraph(dir), live, opts.vsts === "none");
    } catch {
      // The compile read the song; a graph that will not load here is no reason to stop playing it live.
      return { doc: live, freezes: [] };
    }
    // An engine that hosts every VST of a freeze plays them live; the render is for one that cannot.
    const ready = freezes.filter(playsRender);
    if (!ready.length) return { doc: live, freezes };
    return {
      doc: compileNodeProjectIn(
        dir,
        Object.fromEntries(ready.map((f) => [f.module, f.render])),
      ),
      freezes,
    };
  });
}

function compileNodeProjectIn(
  dir: string,
  /** Automatic freezes in force, module → render: frozen exactly as a `frozen:` field would be. */
  autoFrozen: Record<string, string> = {},
): ProjectDoc {
  const inp = loadCompileInputs(dir);
  checkReferences(dir, inp);
  const own = chainOwnership(inp);
  const { frozenLanes, frozenPlugins, renderOn } = freezePoints(
    dir,
    inp,
    own,
    autoFrozen,
  );
  const { trackPlugins, laneHints, trackSends, rawAutomations, pluginOfNode } =
    compilePlugins(dir, inp, own, frozenPlugins);
  const {
    root,
    roots,
    moduleRefs,
    lanesMap,
    chains,
    bypassed,
    busOnly,
    clipsMap,
    seqMap,
  } = inp;
  const { isCued, cuePair, busChains, inputChains, tapChains } = own;

  const proj = root.project ?? {};
  // Read here with the time signature, because the track clips below turn a timecode window into seconds with it.
  const tempo = Number(proj.tempo ?? 120);
  const ts = String(proj.timeSignature ?? "4/4");
  const [num, den] = ts.split("/").map((n) => parseInt(n, 10));
  if (!num || !den)
    throw new Error(`timeSignature must look like '4/4', got '${ts}'`);

  // The engine tracks one lane compiles to — its HALVES, one per output port it was keyed on (docs/graphModel.md).
  interface Half {
    id: string;
    port?: string; // "audio" | "midi"; absent means this half takes whatever is left
  }
  const halvesOf = (lane: string): Half[] => {
    const out: Half[] = [];
    for (const [name, c] of Object.entries(chains))
      if (c.from === lane) out.push({ id: name, port: c.fromPort });
    // A lane wired to nothing still plays: it is a track with no plugins, which is what an unrouted lane IS.
    return out.length ? out : [{ id: lane }];
  };
  // What an event's ref names, which is the whole of what decides its output port.
  const materialOf = (ref: string): Material =>
    seqMap[ref] ? "midi" : clipsMap[ref] ? "audio" : "missing";
  // The engine's word for what a track holds; a ref resolving to nothing counts as audio, which is what it compiles to.
  const contentTypeOf = (materials: Material[]): string => {
    const midi = materials.includes("midi");
    const audio = materials.some((m) => m !== "midi");
    return midi ? (audio ? "audio notes" : "notes") : "audio";
  };
  // The half an event lands on: the port matching its material, else the one naming none (see laneErrs).
  const halfFor = (halves: Half[], material: Material): Half | undefined =>
    halves.find((h) => h.port === material) ?? halves.find((h) => !h.port);

  // A group holds no material, so it's a parent pointer on its members plus an entry in `groups` — never a lane.
  const groupOf: Record<string, string> = {};
  for (const [id, t] of Object.entries(lanesMap))
    if (t.type === "group") for (const m of t.tracks) groupOf[m] = id;

  const inputOf = liveInputsOf(inp, own);

  // The soloed lanes from project.yaml's `soloed:`, a group's id folded onto its members because the engine never sees grouping.
  const soloed = new Set((root.soloed ?? []).map(String));
  // …and the HIGHLIGHTED ones, heard 10 dB up on their strip's output stage (highlight.ts).
  const lit = new Set((root.highlighted ?? []).map(String));

  const groups: GroupDoc[] = Object.entries(lanesMap)
    .filter(([, t]) => t.type === "group" && !t.disabled)
    .map(([id, t]) => ({
      id,
      name: id,
      color: t.color ?? "",
      mute: bypassed.has(id),
      solo: soloed.has(id),
    }));

  // One entry per HALF, ordered over the LANES so both halves stay adjacent — see docs/trackKind.md.
  const laneErrs: string[] = [];
  // The lanes that play a PICTURE lane's sound, their clips derived from its shots (docs/videoSound.md).
  const videoSounds = videoSoundLanes(
    dir,
    lanesMap,
    loadVideoTracks(dir),
    clipsMap,
    tempo,
    laneErrs,
  );
  // How the pattern lanes share their files, and where their samples are looked for — once per compile.
  const shares = patternShares(dir, lanesMap);
  const banks = sampleBanks(dir);
  const tracks: TrackDoc[] = orderTracks(
    Object.entries(lanesMap).filter(
      ([, t]) => t.type !== "group" && !t.disabled,
    ),
    ([id]) => id,
    root.trackOrder,
  ).flatMap(([lane, t]): TrackDoc[] => {
    const halves = halvesOf(lane);
    // A pattern lane is played by the ENGINE, from a plugin heading each half it has — see enginePattern.ts.
    const share = shares.get(lane);
    const patterns =
      isPatternLane(t) && share
        ? patternPlugins(dir, lane, t, halves, share, banks)
        : new Map<string, PluginDoc>();
    // Which half each of this lane's events plays on; one whose material has no half is NAMED rather than dropped.
    const eventsFor = (evts: typeof t.events, half: Half) =>
      evts.filter((p) => {
        const ref = String(p?.ref ?? "");
        const at = halfFor(halves, materialOf(ref));
        if (!at) {
          const kind = materialOf(ref) === "midi" ? "sequence" : "clip";
          laneErrs.push(
            `lane '${lane}': event '${ref}' is a ${kind}, but only the lane's ` +
              `'${halves.map((h) => h.port).join("', '")}' output is wired — ` +
              `add a '${lane}#${materialOf(ref)}:' key to graph.yaml`,
          );
          return false;
        }
        return at.id === half.id;
      });
    return halves.map((half): TrackDoc => {
      const id = half.id;
      // An interface input carries audio, so it lands on whichever half takes audio.
      const inp =
        inputOf[id] ??
        (halfFor(halves, "audio") === half ? inputOf[lane] : undefined);
      const events = eventsFor(t.events, half);
      // One placement is one clip, or the pieces of its comp when it has one (docs/takes.md).
      const placed = (p: RawPlacement): ClipDoc[] =>
        compClips(
          p,
          placementToClip(dir, p, clipsMap, seqMap, num, den, tempo, roots),
          (ref, start) =>
            placementToClip(
              dir,
              { ref, start },
              clipsMap,
              seqMap,
              num,
              den,
              tempo,
              roots,
            ),
          num,
          den,
          tempo,
        );
      return {
        id,
        name: id,
        role: "regular",
        // The engine's vocabulary, and the one place its third value ("audio notes") is ever written.
        contentType: half.port
          ? half.port === "midi"
            ? "notes"
            : "audio"
          : t.type === "strudel"
            ? // A generated lane holds nothing when stopped, so it takes whatever the pattern turns out to play.
              "audio notes"
            : contentTypeOf(
                events.map((p) => materialOf(String(p?.ref ?? ""))),
              ),
        group: groupOf[lane] ?? "",
        generated: t.type === "strudel",
        color: t.color ?? "",
        // The lane's own bypass, taken by both halves: muting is a fact about the lane, not about one of its outputs.
        mute: bypassed.has(lane),
        // Its own entry, or its group's — the fold the engine cannot do (see `soloed` above).
        solo: soloed.has(lane) || soloed.has(groupOf[lane] ?? ""),
        disabled: false, // filtered out above
        // From the io "in" module that names this track, if any (see inputOf above).
        inputChannels: inp?.channels ?? [],
        // A LANE always reaches the mixer's sum: only a bus may be lifted off it, and only by CUE (docs/cue.md).
        outputChannels: [],
        monitor: inp?.monitor ?? "auto",
        inputGain: inp?.gain ?? 0,
        // A FROZEN lane, in three states whose ORDER matters — see docs/freeze.md.
        clips: renderOn.has(id)
          ? [frozenClip(id, renderOn.get(id) as string)]
          : frozenLanes.has(lane)
            ? []
            : videoSounds.has(lane)
              ? // A sounding lane's clips are its picture lane's shots, on the half that takes audio.
                halfFor(halves, "audio") === half
                ? markCrossfades(videoSounds.get(lane) ?? [])
                : []
              : // The lane's authored `events:` become the engine's `clips` — this line IS the boundary between the two words.
                markCrossfades(events.flatMap(placed)),
        // …and what the render replaced, kept for the browser to draw over it and open (docs/freeze.md).
        ...(frozenLanes.has(lane) && events.length
          ? {
              frozenMaterial: events.flatMap(placed),
            }
          : {}),
        plugins: ((ps: PluginDoc[]) => (lit.has(lane) ? highlighted(ps) : ps))([
          ...(patterns.has(id) ? [patterns.get(id) as PluginDoc] : []),
          ...(trackPlugins[id] ?? []),
        ]),
        ...(lit.has(lane) ? { highlight: true } : {}),
        sends: trackSends[id] ?? [],
        automation: [],
        // No `docs`/`todos` carried through: a note is a doc module (docs/docModules.md).
      };
    });
  });
  if (laneErrs.length)
    throw new Error(
      `lane wiring invalid:\n  - ${[...new Set(laneErrs)].join("\n  - ")}`,
    );

  // A chain project keys a run by its head's id; its strip is LABELLED by the chain file holding it (docs/chainFiles.md).
  const chainNodes = isChainProject(dir) ? readChainProject(dir).nodes : {};
  const labelOf = (key: string): string => chainNodes[key]?.chain ?? key;

  // A channel per lane-less INPUT run: what a rig you play through is made of. No clips — what is
  // heard is what is plugged in — and `regular` rather than `effect`, since it is not a return.
  for (const name of inputChains) {
    const inp = inputOf[name];
    tracks.push({
      id: name,
      name: labelOf(name),
      role: "regular",
      contentType: "audio",
      group: "",
      generated: false,
      color: "",
      mute: bypassed.has(name),
      solo: soloed.has(name),
      disabled: false,
      inputChannels: inp?.channels ?? [],
      // It reaches the sum like a lane; only a bus may be lifted off it, and only by CUE.
      outputChannels: isCued(chains[name]) ? cuePair : [],
      monitor: inp?.monitor ?? "auto",
      inputGain: inp?.gain ?? 0,
      clips: [],
      plugins: trackPlugins[name] ?? [],
      sends: trackSends[name] ?? [],
      automation: [],
    });
  }

  // A return track per bus — and per run a routed tap feeds: no clips, the run's plugins after its return, and onward sends.
  for (const name of [
    ...busChains,
    ...[...tapChains.keys()].filter((n) => !busChains.has(n)),
  ])
    tracks.push({
      id: name,
      name: labelOf(name),
      role: "effect",
      contentType: "audio",
      group: "",
      generated: false,
      inputChannels: [], // a bus return is fed by sends, never by the interface
      // A bus reaching CUE leaves the mixer's sum by its own pair; every other bus arrives at the sum (docs/cue.md).
      outputChannels: isCued(chains[name]) ? cuePair : [],
      monitor: "auto",
      inputGain: 0,
      color: "",
      // Three different sentences that all end in silence on the sum — docs/busOnly.md and docs/cue.md.
      mute:
        bypassed.has(name) ||
        busOnly.has(name) ||
        (isCued(chains[name]) && cuePair.length === 0),
      // A bus return can be soloed like any lane — it is a strip on the same mixer.
      solo: soloed.has(name),
      disabled: false,
      // A bus frozen at one of its own modules plays the render here, carrying what its now-silent lanes summed to.
      clips: renderOn.has(name)
        ? [frozenClip(name, renderOn.get(name) as string)]
        : [],
      plugins: trackPlugins[name] ?? [],
      sends: trackSends[name] ?? [],
      automation: [],
      // Fed by one pair of the rack node's instrument (engine docs/tapOutputs.md).
      ...(() => {
        const tap = tapChains.get(name);
        const plugin = tap ? pluginOfNode.get(tap.node) : undefined;
        return tap && plugin ? { inputFrom: { plugin, pair: tap.pair } } : {};
      })(),
    });

  bakeAutomations(dir, inp, own, rawAutomations, tracks, num, den, tempo);

  // PICTURE IS NOT HERE: the same folder compiles twice, and this is the pass the C++ engine reads (packages/song-video/docs/picture.md).

  // A lane that states no colour takes its category's shade, by lane so both halves of one share it (song-schema docs/trackColor.md).
  const laneOrder = [...new Set(tracks.map((t) => t.name))];
  const hintsOfLane = new Map<string, string[]>();
  for (const t of tracks)
    hintsOfLane.set(t.name, [
      ...(hintsOfLane.get(t.name) ?? []),
      ...(laneHints[t.id] ?? []),
    ]);
  const shades = autoColors(
    laneOrder.map((lane) => ({
      id: lane,
      category: trackCategory(lane, hintsOfLane.get(lane) ?? []),
    })),
  );
  for (const t of tracks) if (!t.color) t.color = shades.get(t.name) ?? "";

  // The console's two halves go on LAST, over the finished mix — docs/console.md.
  return withConsole(
    {
      name: String(proj.name ?? "untitled"),
      tempo,
      sampleRate: Number(proj.sampleRate ?? 48000),
      timeSigNumerator: num || 4,
      timeSigDenominator: den || 4,
      // Unity when the song says nothing, DEFAULTED rather than absent because the engine diffs documents (docs/masterVolume.md).
      masterVolume: Number(proj.masterVolume ?? 0),
      // The master chain's steps in chain order, always sent for the reason `masterVolume` is (docs/masterChain.md).
      masterPlugins: trackPlugins[MASTER_OWNER] ?? [],
      recordDir: "", // set by loadProject, which is what knows this is a folder project
      tracks,
      groups,
      markers: parseMarkers(root.markers, num || 4, den || 4),
      // settings.yaml is a flat root file, loaded on its own and validated as it is read (a bad value fails the compile).
      settings: parseSettings(loadSettings(dir, true)),
    },
    typeof proj.console === "string" ? proj.console : undefined,
    moduleRefs,
  );
}
