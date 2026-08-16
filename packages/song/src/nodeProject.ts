// nodeProject.ts — compile a chains/modules node project (a graph) into the flat
// tracks-with-clips-and-plugins ProjectDoc the engine plays: each track becomes a lane,
// each chain's `use` steps become that track's plugins in order.
// Full rationale: docs/nodeProject.md.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bypassedOf } from "./chainsGraph";
import { bakeCurve, loadCurves } from "./curves";
import { activeFreezePlans } from "./freeze";
import {
  type Chain,
  checkChainInputs,
  inputLandingTrack,
  parseChains,
} from "./graph";
import {
  type Diagnostic,
  exportSub,
  loadChains,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  loadSettings,
  loadVideoTracks,
  readYamlEntities,
  withChainModuleRefs,
} from "./loader";
import { withModuleStamp } from "./moduleCache";
import { resolvedRack, resolvedType, resolveModuleMap } from "./moduleResolve";
import {
  defaultPreferences,
  loadPreferences,
  type Preferences,
  resolveInput,
} from "./preferences";
import type {
  ClipDoc,
  GroupDoc,
  NoteDoc,
  PluginDoc,
  ProjectDoc,
  RackSoundDoc,
  SendDoc,
  TrackDoc,
} from "./project";
import {
  EXTERNAL_PLUGIN_FORMATS,
  enginePlugin,
  JSDSP_TYPE,
  MIXER_PLUGIN,
  OFFLINE_TYPE,
  parseMarkers,
  parseSettings,
} from "./project";
import type { RawClip, RawPlacement, RawSequence } from "./rawDoc";
import { parseDuration, parsePosition } from "./timecode";
import { sortTracksByKind } from "./trackKind";
import { type Lane, lanesOf } from "./trackModule";
import { DEFAULT_PROJECT_MODE } from "./yaml/projectSchema";

// A placement -> a resolved ClipDoc. `start`/`loop` are 1-based positions, the rest 0-based durations.
function placementToClip(
  dir: string,
  p: RawPlacement,
  clipsMap: Record<string, RawClip>,
  seqMap: Record<string, RawSequence>,
  num: number,
  den: number,
  tempo: number,
): ClipDoc {
  const ref = String(p.ref ?? "");
  const pos = (tc: unknown) =>
    tc != null && tc !== "" ? parsePosition(String(tc), num, den) : 0;
  const dur = (tc: unknown) =>
    tc != null && tc !== "" ? parseDuration(String(tc), num, den) : 0;
  /**
   * A clip's window edge, always as SECONDS — which is what the engine takes, and what a window into a file
   * means. A number is already seconds; a timecode is musical and converted here, where the tempo is known.
   * Undefined when unwritten, so "no window" stays distinguishable from "a window starting at 0".
   *
   * A timecode edge is a POSITION, not a duration: `from: "2:1"` is bar 2 beat 1 OF THE FILE, read exactly like
   * the `start:` beside it, so `"1:1"` is the file's beginning. Reading it as a duration ("two bars and a beat
   * IN") lands a whole bar late and is indistinguishable from the right answer until you hear it.
   */
  const edge = (v: unknown): number | undefined => {
    if (v == null || v === "") return undefined;
    if (typeof v === "number")
      return Number.isFinite(v) && v > 0 ? v : undefined;
    const beats = pos(v);
    return beats > 0 ? (beats * 60) / tempo : undefined;
  };
  // How many times the material's window is played, back to back. Absent is one pass.
  const loops = Math.max(1, Math.floor(Number(p.loop ?? 1)) || 1);
  const base: ClipDoc = {
    id: ref,
    type: "audio",
    name: ref,
    source: "",
    start: pos(p.start),
    // Filled in per kind below: a placement no longer states its extent, it is `loops` × the window.
    length: 0,
    offset: 0,
    fadeIn: dur(p.fadeIn),
    fadeOut: dur(p.fadeOut),
    loopStart: 0,
    loopEnd: 0,
    notes: [],
    // Carried, not filtered: the timeline draws a disabled event dimmed, so it has to
    // reach the surfaces. The ENGINE is what skips it (EditBuilder).
    ...(p.disabled ? { disabled: true } : {}),
  };
  if (clipsMap[ref]) {
    const cm = clipsMap[ref];
    // Absent or malformed -> no warp, and the clip plays at its natural rate.
    const warp =
      cm.warp && Array.isArray(cm.warp.markers) && cm.warp.markers.length >= 2
        ? {
            algorithm: String(cm.warp.algorithm ?? "elastique"),
            markers: cm.warp.markers.map((m): [number, number] => [
              Number(m[0]),
              Number(m[1]),
            ]),
          }
        : undefined;
    /**
     * The effective window: the clip's own, narrowed by the EVENT's (`from`/`to` on the
     * placement). The most restrictive edge wins — the larger `from`, the smaller `to` — so an
     * event can only play less of the material than the clip declares, never more. An empty
     * intersection compiles like an open extent (length 0, nothing above zero to play).
     */
    const cFrom = edge(cm.from);
    const cTo = edge(cm.to);
    const pFrom = edge(p.from);
    const pTo = edge(p.to);
    const from =
      cFrom != null || pFrom != null
        ? Math.max(cFrom ?? 0, pFrom ?? 0)
        : undefined;
    const to = cTo != null && pTo != null ? Math.min(cTo, pTo) : (cTo ?? pTo);
    /**
     * The window, in beats — the clip's extent, stated whenever the file says enough to know it.
     *
     * `length` stays 0 only for a clip with no `to`, which means "to the end of the source": a duration this
     * compiler cannot know without opening the wav, and which the ENGINE fills in from the file it holds. That
     * 0 is why an untrimmed clip draws as a single bar on the timeline — the surfaces have no file to measure.
     *
     * Passing it through cannot make the engine play MORE than it does today: clipPositionFor caps an unlooped
     * clip's end at the window regardless (see EditBuilder). Repeating is the one case the engine cannot do
     * alone — it has no count — so a loop needs a `to`, checked when the project is read.
     */
    // An absent `from` is the file's start, not an absent window: only `to` decides whether the extent is known.
    const winBeats =
      to != null && to > (from ?? 0) ? ((to - (from ?? 0)) * tempo) / 60 : 0;
    return {
      ...base,
      type: "audio",
      source: resolve(dir, String(cm.source)),
      ...(winBeats > 0 ? { length: winBeats * loops } : {}),
      ...(loops > 1 && winBeats > 0
        ? {
            // Beats into the SOURCE, like the window they come from — the in-point is applied separately.
            loopStart: ((from ?? 0) * tempo) / 60,
            loopEnd: ((to ?? 0) * tempo) / 60,
          }
        : {}),
      // The clip's own window into its file — every placement of it plays that slice (see AudioClipSchema).
      ...(from != null ? { sourceFrom: from } : {}),
      ...(to != null ? { sourceTo: to } : {}),
      ...(warp ? { warp } : {}),
    };
  }
  if (seqMap[ref]) {
    // Notes are inline in the sequence's .yaml (compact {t,d,k,v}).
    const notes: NoteDoc[] = (
      Array.isArray(seqMap[ref].notes) ? seqMap[ref].notes : []
    ).map((n: { t?: unknown; d?: unknown; k?: unknown; v?: unknown }) => ({
      time: Number(n?.t ?? 0),
      duration: Number(n?.d ?? 0),
      key: Number(n?.k ?? 0),
      vel: Number(n?.v ?? 1),
      channel: 0,
      rel: 1,
    }));
    /**
     * The sequence's window, in beats. `from`/`to` are POSITIONS in the notes, read like the `start:` on the
     * placement — `"1:1"` is the first beat. Unwritten, the window is everything the notes cover.
     *
     * It reaches the engine as the clip's LOOP RANGE, which is the only thing that can say "play from bar 5":
     * a MIDI clip ignores `offset` (see insertMidiClip). A window the file never wrote needs no range at all —
     * the clip's own end already stops it — so it is left unset there rather than written as a loop that must
     * never come round, and the roll then bands every sequence in the project with the whole of itself.
     */
    // The default `to`, when the file says none: the notes' extent rounded UP TO THE BAR. Not the bare extent —
    // a two-bar drum pattern whose last hit is on the fourth sixteenth would otherwise be 3.75 beats long, and
    // every repeat of it would drift. Material is written in bars; a sequence that means otherwise says `to`.
    const bar = (num * 4) / den;
    const extent =
      Math.ceil(
        notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0) / bar,
      ) * bar;
    // The sequence's own window first, with its fallback: a malformed `to` (at or before
    // `from`) falls back to the notes' extent rather than compiling a window that plays nothing.
    const mFrom = seqMap[ref].from != null ? pos(seqMap[ref].from) : 0;
    const mToRaw = seqMap[ref].to != null ? pos(seqMap[ref].to) : extent;
    const mTo = mToRaw > mFrom ? mToRaw : extent > mFrom ? extent : mFrom;
    // …then the EVENT's, intersected exactly as an audio placement's is with its clip's: the
    // larger `from`, the smaller `to` — positions in the notes, like the material's own pair.
    // No fallback HERE: an event window disjoint from the material's is empty and plays nothing,
    // where a malformed material window above meant "the file is wrong, keep the notes".
    const eFrom = p.from != null ? pos(p.from) : null;
    const eTo = p.to != null ? pos(p.to) : null;
    const wFrom = Math.max(mFrom, eFrom ?? 0);
    const wTo = Math.max(wFrom, eTo != null ? Math.min(mTo, eTo) : mTo);
    const win = wTo - wFrom;
    // A `to` that WAS written and does not land on the extent says something the notes do not: it cuts a tail
    // that is in the file, or it pads past the last hit. Either is worth a range, and without one the roll has
    // nothing to draw — the case `from` is absent and the clip plays once was the hole.
    const statedTo =
      (seqMap[ref].to != null || eTo != null) && Math.abs(wTo - extent) > 1e-9;
    return {
      ...base,
      type: "midi",
      notes,
      length: win * loops,
      ...(win > 0 && (loops > 1 || wFrom > 0 || statedTo)
        ? { loopStart: wFrom, loopEnd: wTo }
        : {}),
    };
  }
  return base; // dangling ref — empty audio clip (engine warns on the missing source)
}

/**
 * A module's DSP graph, from the JS/TS source it declares with `jsdsp:`.
 *
 * The source is RUN — in a child process, because this compiler is synchronous and an `import()` is not, and
 * turning `loadProject` async would ripple through every caller for one field. The cost is ~200 ms of Node
 * startup, which is why the result is cached as a sibling `.json` and only regenerated when the source is
 * newer. Steady state is a file read; you pay the 200 ms once, on the edit.
 *
 * That sibling is also the artifact worth committing: it is what actually ran, it diffs, and a checkout with no
 * Node still plays the song.
 *
 * The child receives the builder as an argument (see dspRunner.mjs), so the module's file imports nothing at
 * runtime — a song folder has no node_modules and should never need one.
 *
 * Nothing here is fatal. A source that throws, or a runner that cannot start, leaves the last good `.json` in
 * place if there is one; failing that the module falls back to the plugin's own default graph and the engine
 * says so. One broken effect must not take a song down.
 */
/**
 * `params` as the engine takes them: numbers only.
 *
 * A file-valued param (`nam`) is authored in the same map, because to the person editing the
 * module it IS one of the plugin's controls. It cannot travel as one: the wire's params are
 * `Record<string, number>`, mirrored in C++ as a float map, and a string there is not a value
 * the engine could set. It leaves as `namFile` instead, which is what the engine already
 * expected — so the authored shape changed and the protocol did not.
 */
function numericParams(
  params: Record<string, number | string> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params ?? {}))
    if (typeof v === "number") out[k] = v;
  return out;
}

function readJsDspGraph(source: string): string | undefined {
  if (!existsSync(source)) return undefined;
  const built = source.replace(/\.[tj]sx?$/, "") + ".json";
  const fresh =
    existsSync(built) && statSync(built).mtimeMs >= statSync(source).mtimeMs;
  if (fresh) {
    try {
      const text = readFileSync(built, "utf8");
      JSON.parse(text);
      return text;
    } catch {
      /* the cache is corrupt — fall through and rebuild it */
    }
  }
  try {
    const runner = fileURLToPath(new URL("./dspRunner.mjs", import.meta.url));
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", runner, source],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
    JSON.parse(out); // refuse to cache something the engine could not read
    // Normalised BEFORE both the write and the return, so a fresh compile and a later cache hit yield the same
    // string. They did not, and the engine diffs this field: every first compile after an edit would have looked
    // like a graph change and rebuilt a plugin that had not moved.
    const text = out.endsWith("\n") ? out : `${out}\n`;
    writeFileSync(built, text, "utf8");
    return text;
  } catch {
    // Keep playing what last worked rather than going silent on a typo.
    if (existsSync(built)) {
      try {
        return readFileSync(built, "utf8");
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/**
 * What a render's clip id ends with, and the test for one — a RESERVED suffix.
 *
 * A frozen lane's clip answers to no `clips:` entry: it is a render, not a placement. Anything
 * that would edit a placement has to know that, and the compiled doc has no other way to say it
 * (`ClipDoc` is the engine's wire, and the engine has no use for the distinction). So the id is
 * the marker, and it is declared here rather than sniffed for at the far end. See docs/freeze.md.
 */
export const FROZEN_CLIP_SUFFIX = "__frozen";
export const isFrozenClipId = (id: string): boolean =>
  id.endsWith(FROZEN_CLIP_SUFFIX);

// The one clip a frozen track plays: the render, from bar 1, for as long as it lasts. `length: 0` is not "empty" —
// it is how the engine is told to use the file's natural length (see clipPositionFor), which is the only right
// answer here, since the render was bounced from this very song and already ends where it ends.
function frozenClip(id: string, source: string): ClipDoc {
  return {
    id: `${id}${FROZEN_CLIP_SUFFIX}`,
    type: "audio",
    name: `${id} (frozen)`,
    source,
    start: 0,
    length: 0,
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    loopStart: 0,
    loopEnd: 0,
    notes: [],
  };
}

// The engine's monitor vocabulary; anything else (including absent) is "auto" — audible only once armed.
// A boolean is the everyday spelling and maps onto the ends of the same scale; only the tri-state can say "auto".
function normMonitor(v: unknown): string {
  if (typeof v === "boolean") return v ? "on" : "off";
  return v === "off" || v === "on" ? v : "auto";
}

// Input trim in dB. Non-finite (or absent) is unity — a gain the file can't state is not a reason to change one.
function normGain(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// A compile READS the project and writes nothing, so one walk of the module folders covers it
// however many times it asks the module cache — twice, today. See moduleCache.ts.
export function compileNodeProject(dir: string): ProjectDoc {
  return withModuleStamp(dir, () => compileNodeProjectIn(dir));
}

function compileNodeProjectIn(dir: string): ProjectDoc {
  // The rig, not the song — unreadable preferences mean no labels resolve, never a failed compile.
  let prefs: Preferences;
  try {
    prefs = loadPreferences();
  } catch {
    prefs = defaultPreferences();
  }
  const root = loadProjectRoot(dir, true); // the root file -> project, markers
  const rawChains = loadChains(dir, root, true);
  const localModules = loadModules(dir, true); // validated as read — this doc feeds the engine
  // Read WITH their issues, for the same reason the clips are: a library module the schema
  // rejects is dropped from this map, and without its own complaint the only symptom is
  // "extends unknown module" about a file sitting right there on disk.
  const refIssues: Diagnostic[] = [];
  const moduleRefs = loadModuleRefs(dir, undefined, refIssues); // the `extends` vocabulary
  // The LANES, before the chains: a run is named after its lane, and only `extends` says which
  // node is one (docs/trackModules.md). Folded from the local modules alone — a chain-named ref
  // is `@engine/…` or a shared library's, never a lane.
  const lanesMap = lanesOf(resolveModuleMap(localModules, moduleRefs));
  const chains: Record<string, Chain> = parseChains(
    rawChains,
    (n) => n in lanesMap,
  ); // keyed by each head's resolved name
  // A lane's MUTE, from the one place a bypass is written.
  const bypassed = bypassedOf(rawChains);
  // Read WITH their issues: a clip file the schema rejects is dropped from the map, and without this the only
  // symptom is the track's ref reading as "not found" — which sends you looking for a missing file that is
  // sitting right there. The file's own complaint is the answer, so it has to survive to the report below.
  const clipsRead = readYamlEntities(dir, "clips");
  const clipsMap = clipsRead.values as Record<string, RawClip>;
  const seqMap = exportSub(dir, "sequences");
  const videoTracksMap = loadVideoTracks(dir, true);
  // Plus the shared modules the chains name by ref — a step may use one directly.
  // Resolved here, once: every `extends` is folded in before the compile loop reads a
  // field, which is what lets it read `module.ir` rather than `module.ir ?? base.ir`.
  const modulesMap = resolveModuleMap(
    withChainModuleRefs(localModules, moduleRefs, chains),
    moduleRefs,
  );

  // Unresolved references fail loudly rather than being silently dropped — see docs/nodeProject.md.
  const refErrs: string[] = [];
  for (const [chainName, c] of Object.entries(chains))
    for (const step of c.use) {
      const moduleName = String(step?.module ?? "");
      const module = modulesMap[moduleName];
      // A missing module is NOT fatal: it compiles to nothing, like a bypassed step, and the graph draws a `?`.
      if (!module) continue;
      const ext = String(module.extends ?? "");
      if (ext && !moduleRefs[ext]) {
        // On disk but unreadable is a different fault from absent, and only the file's own
        // complaint says which line is wrong — the same distinction the clip check makes.
        const broke = refIssues.find((i) => i.file.startsWith(`${ext}/`));
        refErrs.push(
          broke
            ? `module '${moduleName}': extends '${ext}', which ${broke.message}`
            : `module '${moduleName}': extends unknown module '${ext}'`,
        );
      }
    }
  for (const [trackId, t] of Object.entries(lanesMap))
    for (const p of t.clips) {
      const ref = String(p?.ref ?? "");
      if (!ref) continue;
      const clip = clipsMap[ref];
      const seq = seqMap[ref];
      if (!clip && !seq) {
        // A file that EXISTS but failed to load is a different fault from a missing one, and only its own
        // complaint says which line is wrong — so it is reported instead of "not found".
        const broke = clipsRead.issues.find((i) =>
          i.startsWith(`clips/${ref}.`),
        );
        refErrs.push(
          broke
            ? `track '${trackId}': clip '${ref}' failed to load — ${broke}`
            : `track '${trackId}': clip/sequence '${ref}' not found`,
        );
      } else if (
        clip &&
        !(clip.source && existsSync(resolve(dir, String(clip.source))))
      )
        refErrs.push(
          `track '${trackId}': audio clip '${ref}' file missing (${clip.source ?? "?"})`,
        );
      // A sequence's notes are inline — its presence in seqMap is the whole check.

      // Repeating needs a known end. A sequence always has one (its last note), and so does an audio clip that
      // says `to`; without it the length of an audio loop is a property of a file this compiler has not opened,
      // and the engine has no count to multiply it by. Refuse rather than play the first pass and drop the rest.
      const loops = Number(p?.loop ?? 1);
      if (clip && loops > 1 && clip.to == null)
        refErrs.push(
          `track '${trackId}': clip '${ref}' is placed with loop: ${loops}, but declares no 'to' — a repeat needs the window's end`,
        );
    }
  // The pattern file must exist; whether it HAS the named lane needs it evaluated, so patternClock reports that.
  for (const [trackId, t] of Object.entries(lanesMap))
    if (t.strudel && !existsSync(resolve(dir, t.strudel)))
      refErrs.push(
        `track '${trackId}': strudel pattern '${t.strudel}' file missing`,
      );

  // `video_tracks/` is deliberately unchecked here: the same folder compiles twice, and
  // `loadVideoProject` is the compile that reads picture (docs/picture.md). This one says
  // nothing about it, which is what keeps the frame out of the document the C++ engine is
  // handed.

  if (refErrs.length)
    throw new Error(`unresolved reference(s):\n  - ${refErrs.join("\n  - ")}`);

  // Reject a project whose chains don't feed their modules' declared input ports.
  const inputErrs = checkChainInputs(
    chains,
    modulesMap,
    lanesMap,
    clipsMap,
    seqMap,
  );
  if (inputErrs.length)
    throw new Error(
      `module input wiring invalid:\n  - ${inputErrs.join("\n  - ")}`,
    );

  // A track-fed chain processes its track; another used as a send target becomes a bus return. See docs/nodeProject.md.
  const outTargets = (c: Chain): { to: string; gain: number }[] => c.out;
  const isSink = (to: string) =>
    !to || to === "OUT" || modulesMap[to]?.kind === "io";
  const isTrackFed = (c: Chain) => !!c.from && !!lanesMap[c.from];

  // Non-sink targets naming a chain that isn't track-fed: routing into a track's input is inexpressible, so they drop.
  const busChains = new Set<string>();
  for (const c of Object.values(chains))
    for (const { to } of outTargets(c))
      if (!isSink(to) && chains[to] && !isTrackFed(chains[to]))
        busChains.add(to);

  // The track id a chain contributes to: its source track, or its own bus track.
  const ownerOf = (name: string, c: Chain): string =>
    isTrackFed(c) ? String(c.from) : busChains.has(name) ? name : "";

  // --- FROZEN points (see docs/freeze.md) --------------------------------------
  //
  // A module carrying `frozen:` stands in for everything UPSTREAM of it, itself included: those
  // lanes lose their clips, those modules lose their plugins, and the render becomes the one clip
  // of the track the frozen module compiles onto.
  //
  // A render that is not on disk is not an error, and `activeFreezePlans` is where that is
  // decided — for both readers of the field at once, so the compiler and the graph cannot
  // disagree about which nodes are baked.
  const plans = activeFreezePlans(
    chains,
    modulesMap,
    (n) => n in lanesMap,
    (r) => existsSync(resolve(dir, r)),
  );
  const frozenLanes = new Set(plans.flatMap((p) => [...p.lanes]));
  const frozenPlugins = new Set(plans.flatMap((p) => [...p.modules]));
  // Which track plays each render: the one the frozen module's own chain compiles onto. For a
  // point inside a lane's run that is the lane; for a bus, the bus's own return track. One rule,
  // both shapes.
  const renderOn = new Map<string, string>();
  for (const p of plans)
    for (const [name, c] of Object.entries(chains))
      if (c.use.some((s) => s.module === p.at)) {
        const owner = ownerOf(name, c);
        if (owner) renderOn.set(owner, resolve(dir, p.render));
      }

  /**
   * The TRACK a step's side input comes from, or "" when it resolves to none.
   *
   * A step's `in` names NODES — a chain, or the track feeding one (see docs/ports.md) — and the engine routes
   * a second signal from a LANE, so each is put through the same ownership rule the plugins are: a track-fed
   * chain contributes to its source track, a bus to its own return track. Anything else (a chain that feeds
   * neither) has nothing the engine could route from, and compiles to no second input rather than to a lie.
   */
  const sideInputTrack = (id: string): string => {
    const c = chains[id];
    if (c) return ownerOf(id, c);
    if (lanesMap[id]) return id;
    // …and a STEP in the middle of a run. `chainsGraph` records the feeder by its own name, so
    // a module wired to a port from inside another chain arrives here as a step name rather
    // than as that chain's. The signal it carries is its chain's, so the lane is that chain's
    // owner — one level deeper, same ownership rule.
    //
    // `deckB: [ tempoB ]` + `tempoB: [ crossfade#b ]` is exactly this shape, and it appears the
    // moment a deck gets anything of its own before the meeting point. Without this the second
    // input resolved to nothing and the deck went SILENT, with the chains file, the graph and
    // the panel all still saying it was wired.
    for (const [name, chain] of Object.entries(chains))
      if (chain.use.some((s) => s?.module === id)) return ownerOf(name, chain);
    return "";
  };

  const trackPlugins: Record<string, PluginDoc[]> = {};
  const trackSends: Record<string, SendDoc[]> = {};
  // Collected here, baked into breakpoints below once the song's length (for LFO sampling) is known.
  const rawAutomations: {
    owner: string;
    pluginId: string;
    param: string;
    curve: string;
  }[] = [];
  for (const [name, c] of Object.entries(chains)) {
    const owner = ownerOf(name, c);
    if (!owner) continue; // a chain that neither feeds a track nor is a used bus
    for (const step of c.use) {
      // Inside a render: the engine never builds this plugin, because its processing is already
      // in the wav. Skipped before the automations below as well as before the plugin itself — a
      // curve driving a plugin the document does not contain would bake breakpoints for an id
      // nothing answers to.
      if (frozenPlugins.has(step?.module)) continue;
      const module = modulesMap[step?.module];
      for (const a of Array.isArray(module?.automations)
        ? module.automations
        : [])
        if (a?.param && a?.curve)
          rawAutomations.push({
            owner,
            pluginId: `${name}:${step.module}`,
            param: String(a.param),
            curve: String(a.curve),
          });
      if (!module) continue; // dangling module ref — already reported by the ref-check loop
      if (module.kind !== "plugin") continue; // an io module contributes no track processor
      // A rack compiles to a SamplerPlugin, both flavours unified into the engine's
      // (clip, start, length) sound shape. Checked BEFORE plugin.type, since a rack
      // module carries no `plugin` — see docs/nodeProject.md.
      if (resolvedType(module) === "rack") {
        const rack = resolvedRack(module);
        // Already absolute from resolveRackAudio; the guard covers any residual relative path.
        const toAbs = (p: string | undefined): string =>
          p ? (isAbsolute(p) ? p : resolve(dir, p)) : "";
        const sourceAbs = rack.rackType === "slice" ? toAbs(rack.source) : "";
        const sounds: RackSoundDoc[] = [];
        for (const [symbol, e] of Object.entries(rack.symbols)) {
          const note = Number(e.note);
          if (!Number.isFinite(note)) continue;
          if (rack.rackType === "slice") {
            if (!sourceAbs) continue; // no resolvable source — nothing to slice
            const from = Number(e.from ?? 0);
            const to = Number(e.to ?? 0);
            sounds.push({
              symbol,
              note,
              clip: sourceAbs,
              start: Math.max(0, from),
              length: Math.max(0, to - from), // <=0 (bad window) -> engine uses natural
            });
          } else {
            const clipAbs = toAbs(e.clip);
            if (!clipAbs) continue;
            sounds.push({ symbol, note, clip: clipAbs, start: 0, length: 0 });
          }
        }
        (trackPlugins[owner] ??= []).push({
          id: `${name}:${step.module}`,
          type: "sampler", // Tracktion's built-in note->sample instrument
          name: step.module,
          path: "",
          presetSave: "",
          role: "instrument",
          enabled: c.enabled !== false && step.enabled !== false,
          params: {},
          rack: sounds,
        });
        continue;
      }

      const plugin = module.plugin;
      // Only a KNOWN format reaches the engine; not_supported/unknown pass through, and the graph flags them.
      //
      // `jsdsp` is one of them. It is what an AUTHOR writes for a module whose DSP is the
      // `jsdsp.ts` beside it, and `enginePlugin` maps it to the built-in graph host two lines
      // down — but this gate ran first and did not know the word, so every module written in
      // the new form was dropped from the compiled doc SILENTLY. Nothing warned: a step whose
      // module compiles to nothing is how a bypass looks. The médiathèque's own modules are
      // exactly the ones already migrated, so they were the ones that vanished.
      const rawType = String(plugin?.type ?? "").toLowerCase();
      // `offline` is the third word this gate knows, and it is skipped on PURPOSE rather than
      // by falling through the branch below. A module that says it is offline has no engine
      // plugin at all: a pass produces its outputs onto disk before the render, which is how a
      // stem separator — one input, four audio files — is expressible at all in a model where a
      // chain step is a serial insert on one track. Saying it here rather than letting it drop
      // is the whole lesson of the paragraph above. See docs/coldModules.md.
      if (rawType === OFFLINE_TYPE) continue;
      if (
        rawType !== "internal" &&
        rawType !== JSDSP_TYPE &&
        !EXTERNAL_PLUGIN_FORMATS.has(rawType)
      )
        continue;
      const { type, name: pluginName } = enginePlugin(plugin, step.module);
      if (!type) continue; // internal missing its name
      // Named by what this step IS, so a node saves beside its own file and never overwrites a sibling's state.
      // A flat node carries its own folder (`home`): its path is `nodes/`, which no longer follows from
      // the category and folder of the module it uses.
      const presetSave = module.home
        ? join(dir, String(module.home), `${String(module.node)}.vstpreset`)
        : join(
            dir,
            "modules",
            String(module.category),
            String(module.file ?? step.module),
            `${String(module.node ?? module.file ?? step.module)}.vstpreset`,
          );
      (trackPlugins[owner] ??= []).push({
        id: `${name}:${step.module}`,
        type, // engine wire form: built-in xmlTypeName (e.g. "4osc") or external format ("vst3")
        // The plugin's real name so the engine can match it in the scan cache to load an
        // external plugin; a built-in falls back to the module name (see enginePlugin).
        name: pluginName,
        path: String(module.preset ?? ""), // resolved preset to load
        // The .nam model, absolute — authored as `params: {nam: …}` and resolved against the
        // module's assets/, but it leaves as its OWN field, because the engine loads it rather
        // than setting it: `params` on the wire is numeric and stays that way.
        ...(module.nam ? { namFile: String(module.nam) } : {}),
        // The DSP graph, built here and carried inline: the engine parses no files, and this one declares the
        // plugin's parameters, so it has to be in the doc rather than fetched later.
        ...(() => {
          const src = module.jsdsp;
          if (!src) return {};
          const json = readJsDspGraph(String(src));
          return json ? { dspGraph: json } : {};
        })(),
        // The feeder of the module's SECOND input port, as a lane. Only the first is carried: Tracktion
        // routes one such source per plugin, so a module declaring a third port can be wired and drawn but
        // not yet fed — see docs/ports.md, which says where that limit sits and why.
        ...(() => {
          const from = (Array.isArray(step.in) ? step.in : [])
            .map(sideInputTrack)
            .find((t) => t);
          return from ? { sidechainFrom: from } : {};
        })(),
        presetSave,
        role: "",
        enabled: c.enabled !== false && step.enabled !== false,
        params: numericParams(module.params), // resolved, so this is exactly what the graph shows
      });
    }
    for (const { to, gain } of outTargets(c)) {
      if (!busChains.has(to)) continue; // dry main out, or an unroutable target
      (trackSends[owner] ??= []).push({
        to,
        level: gain,
        enabled: c.enabled !== false,
      });
    }
  }

  const proj = root.project ?? {};
  // Read with the time signature, not later beside the video maths: the track clips below need it to turn a
  // clip's timecode window into the seconds the engine takes.
  const tempo = Number(proj.tempo ?? 120);
  const ts = String(proj.timeSignature ?? "4/4");
  const [num, den] = ts.split("/").map((n) => parseInt(n, 10));
  if (!num || !den)
    throw new Error(`timeSignature must look like '4/4', got '${ts}'`);

  // A group holds no material, so it's a parent pointer on its members plus an entry in `groups` — never a lane.
  const groupOf: Record<string, string> = {};
  for (const [id, t] of Object.entries(lanesMap))
    if (t.type === "group") for (const m of t.tracks) groupOf[m] = id;

  // An io "in" module is wired by the CHAIN it sits in: the chain already says which
  // track it lands on, so the module carries the channel and nothing else. The engine's
  // model is the reverse of the graph's, so collapse each input onto its chain's track.
  const inputOf: Record<
    string,
    { channels: number[]; monitor: string; gain: number }
  > = {};
  for (const [name, c] of Object.entries(chains)) {
    // The INPUT first, then the track it lands on. The other way round skipped every chain
    // with no owner — and a chain that is only an input feeding a lane has none, since it
    // takes no track and is nobody's bus. That is the shape `IN:in-2: [ ge.rythm ]` makes,
    // and it is the one that reads correctly: signal comes FROM the input, INTO the lane.
    const b = c.use
      .map((s) => modulesMap[s?.module])
      .find((m) => m?.io === "in");
    if (!b) continue;
    const track =
      ownerOf(name, c) || inputLandingTrack(c, (id) => !!lanesMap[id]);
    if (!track || inputOf[track]) continue;
    inputOf[track] = {
      // The seam cast: `channel` passed the module schema (a label or channel list).
      channels: resolveInput(b.channel as string | number[] | undefined, prefs)
        .channels,
      monitor: normMonitor(b.monitor),
      gain: normGain(b.gain),
    };
  }

  // The soloed lanes, from project.yaml's root `soloed:` — solo as project state. A group's id
  // folds onto its member tracks HERE, because the engine resolves solo across TRACKS alone
  // (applySoloMute) and never sees the grouping. An unknown name is inert, like a `bypassed:`
  // entry nothing carries.
  const soloed = new Set((root.soloed ?? []).map(String));

  const groups: GroupDoc[] = Object.entries(lanesMap)
    .filter(([, t]) => t.type === "group" && !t.disabled)
    .map(([id, t]) => ({
      id,
      name: id,
      color: t.color ?? "",
      mute: bypassed.has(id),
      solo: soloed.has(id),
    }));

  // A strudel lane compiles to an EMPTY track carrying its chain's plugins — what the
  // engine should hold when stopped; patternClock fills its clips while rolling.
  // Sorted by instrument family here, on the compiled doc, so every surface and the
  // engine agree on what "the third track" is (see trackKind.ts). The name it sorts on is
  // the NODE's — the lane's file names it, exactly as its track file used to.
  const tracks: TrackDoc[] = sortTracksByKind(
    Object.entries(lanesMap).filter(
      ([, t]) => t.type !== "group" && !t.disabled,
    ),
    ([id]) => id,
  ).map(
    ([id, t]): TrackDoc => ({
      id,
      name: id,
      role: "regular",
      contentType: t.contentType === "sequences" ? "notes" : "audio", // the engine's vocabulary
      group: groupOf[id] ?? "",
      generated: t.type === "strudel",
      color: t.color ?? "",
      // The lane's own bypass. It is the same button every module node carries, and on a source it
      // reads as "produces nothing" — which is what muting a lane has always meant.
      mute: bypassed.has(id),
      // Its own entry, or its group's — the fold the engine cannot do (see `soloed` above).
      solo: soloed.has(id) || soloed.has(groupOf[id] ?? ""),
      disabled: false, // filtered out above
      // From the io "in" module that names this track, if any (see inputOf above).
      inputChannels: inputOf[id]?.channels ?? [],
      monitor: inputOf[id]?.monitor ?? "auto",
      inputGain: inputOf[id]?.gain ?? 0,
      // A FROZEN lane. Three states, and the order matters: the lane the render is taken ON
      // plays it; a lane merely INSIDE the render plays nothing, because its material is already
      // in that file and playing it again would be the take twice; everything else plays its own
      // clips. See docs/freeze.md.
      clips: renderOn.has(id)
        ? [frozenClip(id, renderOn.get(id) as string)]
        : frozenLanes.has(id)
          ? []
          : t.clips.map((p) =>
              placementToClip(dir, p, clipsMap, seqMap, num, den, tempo),
            ),
      // The lane's TAKES, through the SAME compiler its clips go through, so a take has the real
      // extents of the arrangement it was and a surface can draw one without a second reader.
      // Stripped before the document reaches the engine (`withoutTakes`), and left off entirely
      // when there are none — see docs/takes.md.
      ...(t.takes.length
        ? {
            takes: t.takes.map((tk) => ({
              ...(tk.name ? { name: tk.name } : {}),
              clips: tk.clips.map((p) =>
                placementToClip(dir, p, clipsMap, seqMap, num, den, tempo),
              ),
            })),
          }
        : {}),
      plugins: trackPlugins[id] ?? [],
      sends: trackSends[id] ?? [],
      automation: [],
      // `docs`/`todos` were carried through here for the Docs panel. Both are gone: a note is a
      // doc module on the graph now, and the module schema refuses the fields outright — so this
      // could only ever have copied something nothing can author. See docs/docModules.md.
    }),
  );

  // A return track per bus: no clips, the bus chain's plugins (its AuxReturn goes ahead of them), and onward sends.
  for (const name of busChains)
    tracks.push({
      id: name,
      name,
      role: "effect",
      contentType: "audio",
      group: "",
      generated: false,
      inputChannels: [], // a bus return is fed by sends, never by the interface
      monitor: "auto",
      inputGain: 0,
      color: "",
      mute: false,
      // A bus return can be soloed like any lane — it is a strip on the same mixer.
      solo: soloed.has(name),
      disabled: false,
      // A bus frozen at one of its own modules plays the render here: the lanes that met at it
      // are silent, and this return track carries what they summed to.
      clips: renderOn.has(name)
        ? [frozenClip(name, renderOn.get(name) as string)]
        : [],
      plugins: trackPlugins[name] ?? [],
      sends: trackSends[name] ?? [],
      automation: [],
    });

  // Baked here, once every track exists: an LFO is sampled over the song's length (the furthest clip end).
  if (rawAutomations.length) {
    const curvesMap = (() => {
      try {
        return loadCurves(dir);
      } catch {
        return {}; // a broken curve file shouldn't fail the whole compile
      }
    })();
    const songBeats = tracks.reduce(
      (m, t) => t.clips.reduce((mm, c) => Math.max(mm, c.start + c.length), m),
      0,
    );
    const byId = new Map(tracks.map((t) => [t.id, t]));
    for (const ra of rawAutomations) {
      const curve = curvesMap[ra.curve];
      const track = byId.get(ra.owner);
      if (!curve || !track) continue;
      const baked = bakeCurve(curve, num, den, songBeats);
      if (!baked.points.length) continue;
      track.automation.push({
        param: ra.param,
        pluginId: ra.pluginId,
        bipolar: baked.bipolar,
        points: baked.points,
      });
    }
  }

  // PICTURE IS NOT HERE, and that is the point: the SAME folder compiles twice, and this pass
  // is the one whose output reaches the C++ engine. `loadVideoProject` is the other, reading
  // video_tracks.ts against a wall clock this compiler has no use for. Two documents rather
  // than one with a section stripped on the way out — see docs/picture.md.
  //
  // `video_source` — an audio lane inheriting a video lane's placements, so a shot and its sound
  // cannot drift — is sayable in this shape and is not written.

  return {
    name: String(proj.name ?? "untitled"),
    tempo,
    sampleRate: Number(proj.sampleRate ?? 48000),
    timeSigNumerator: num || 4,
    timeSigDenominator: den || 4,
    recordDir: "", // set by loadProject, which is what knows this is a folder project
    tracks,
    groups,
    // Read off the AUTHORED lanes — a strudel lane compiles to an empty one, so by then the fact it streams is gone.
    strudel: Object.values(lanesMap).some((t) => t.type === "strudel"),
    // A ROOT field, so it comes off `root` and not `proj` — see projectSchema.ts on why the
    // shape of the folder is not one of the song's settings.
    mode: root.project_type ?? DEFAULT_PROJECT_MODE,
    markers: parseMarkers(root.markers, num || 4, den || 4),
    // settings.yaml is a flat, package-less root file (not part of `root` above) — load
    // it on its own, validated as it is read (a bad value fails the compile).
    settings: parseSettings(loadSettings(dir, true)),
  };
}
