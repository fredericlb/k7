// nodeProject.ts — compile a chains/modules node project (a graph) into the flat
// tracks-with-clips-and-plugins ProjectDoc the engine plays: each track becomes a lane,
// each chain's `use` steps become that track's plugins in order.
// Full rationale: docs/nodeProject.md.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUE_NODE,
  curveIdFromRef,
  isBuiltinOutput,
  MASTER_OWNER,
  MIX_NODE,
  moduleEmits,
  OUT_NODE,
} from "@studio/song-schema/moduleTypes";
import { materialRefOf, placementId } from "@studio/song-schema/placementId";
import { parseDuration, parsePosition } from "@studio/song-schema/timecode";
import { orderTracks } from "@studio/song-schema/trackKind";
import { readClipWarp } from "@studio/song-schema/warpPoints";
import { busOnlyOf, bypassedOf } from "./chainsGraph";
import { bakeAdsr, bakeCurve, loadCurves } from "./curves";
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
  readYamlEntities,
  withChainModuleRefs,
} from "./loader";
import { withModuleStamp } from "./moduleCache";
import { resolvedRack, resolvedType, resolveModuleMap } from "./moduleResolve";
import {
  defaultPreferences,
  loadPreferences,
  type Preferences,
  resolveCueOutput,
  resolveInput,
} from "./preferences";
import type {
  ClipDoc,
  EventDoc,
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
  FAUST_TYPE,
  JSDSP_TYPE,
  OFFLINE_TYPE,
  parseMarkers,
  parseSettings,
} from "./project";
import type { RawClip, RawPlacement, RawSequence } from "./rawDoc";
import { lanesOf, type Material } from "./trackModule";

// Re-exported from @studio/song-schema, and imported too because `export … from` binds no local name (docs/graphModel.md).
export { materialRefOf, placementId };

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
  // A clip's window edge, always as SECONDS, and a timecode edge is a POSITION rather than a duration (docs/graphModel.md).
  const edge = (v: unknown): number | undefined => {
    if (v == null || v === "") return undefined;
    if (typeof v === "number")
      return Number.isFinite(v) && v > 0 ? v : undefined;
    const beats = pos(v);
    return beats > 0 ? (beats * 60) / tempo : undefined;
  };
  // How many times the material's window is played, back to back. Absent is one pass.
  const loops = Math.max(1, Math.floor(Number(p.loop ?? 1)) || 1);
  // The placement's own words, kept UNMERGED beside the resolved answer and holding only what the file said (docs/graphModel.md).
  const evWin = (v: unknown): number | string | undefined =>
    typeof v === "number" || (typeof v === "string" && v !== "")
      ? v
      : undefined;
  const event: EventDoc = {
    ...(evWin(p.from) !== undefined ? { from: evWin(p.from) } : {}),
    ...(evWin(p.to) !== undefined ? { to: evWin(p.to) } : {}),
    ...(p.fadeIn ? { fadeIn: String(p.fadeIn) } : {}),
    ...(p.fadeOut ? { fadeOut: String(p.fadeOut) } : {}),
    ...(loops > 1 ? { loop: loops } : {}),
    ...(p.disabled ? { disabled: true } : {}),
    // `false` is the only value that says anything here, exactly as the file spells it.
    ...(p.warp === false ? { warp: false } : {}),
  };
  const base: ClipDoc = {
    // The PLACEMENT's identity, not the material's — see placementId and docs/graphModel.md.
    id: placementId(ref, pos(p.start)),
    type: "audio",
    name: ref,
    source: "",
    start: pos(p.start),
    // Filled in per kind below: a placement states no extent, it is `loops` × the window.
    length: 0,
    offset: 0,
    fadeIn: dur(p.fadeIn),
    fadeOut: dur(p.fadeOut),
    loopStart: 0,
    loopEnd: 0,
    notes: [],
    // Carried, not filtered: the timeline draws a disabled event dimmed, and the ENGINE is what skips it.
    ...(p.disabled ? { disabled: true } : {}),
    ...(Object.keys(event).length ? { event } : {}),
  };
  if (clipsMap[ref]) {
    const cm = clipsMap[ref];
    // Read through `readClipWarp` because `project.mapClip` builds the same field for the UNPLACED clip.
    const { map, declined } = readClipWarp(cm.warp);
    // …unless it is declined, which the placement and the clip file may each do and which compile to one answer (docs/warp.md).
    const off = p.warp === false || declined;
    const warp = off ? undefined : map;
    // The effective window: the clip's own narrowed by the EVENT's, most restrictive edge winning (docs/graphModel.md).
    const cFrom = edge(cm.from);
    const cTo = edge(cm.to);
    const pFrom = edge(p.from);
    const pTo = edge(p.to);
    const from =
      cFrom != null || pFrom != null
        ? Math.max(cFrom ?? 0, pFrom ?? 0)
        : undefined;
    const to = cTo != null && pTo != null ? Math.min(cTo, pTo) : (cTo ?? pTo);
    // The window in beats, 0 when the file states no `to` and only the engine can measure it (docs/graphModel.md).
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
      // Only when there is a map to decline: `warp: false` on an unwarped clip says nothing.
      ...(off && map ? { warpOff: true } : {}),
    };
  }
  if (seqMap[ref]) {
    // Notes are inline in the sequence's .yaml; a pad effect is carried, never resolved (docs/padEffects.md).
    const eff = (v: unknown): number | undefined => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 2 ? n : undefined;
    };
    const notes: NoteDoc[] = (
      Array.isArray(seqMap[ref].notes) ? seqMap[ref].notes : []
    ).map(
      (n: {
        t?: unknown;
        d?: unknown;
        k?: unknown;
        v?: unknown;
        repeat?: unknown;
        skip?: unknown;
      }) => ({
        time: Number(n?.t ?? 0),
        duration: Number(n?.d ?? 0),
        key: Number(n?.k ?? 0),
        vel: Number(n?.v ?? 1),
        channel: 0,
        rel: 1,
        ...(eff(n?.repeat) ? { repeat: eff(n?.repeat) } : {}),
        ...(eff(n?.skip) ? { skip: eff(n?.skip) } : {}),
      }),
    );
    // The sequence's window in beats, defaulting to the notes' extent rounded UP TO THE BAR — see docs/graphModel.md.
    const bar = (num * 4) / den;
    const extent =
      Math.ceil(
        notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0) / bar,
      ) * bar;
    // The sequence's own window first: a `to` at or before `from` falls back to the notes' extent.
    const mFrom = seqMap[ref].from != null ? pos(seqMap[ref].from) : 0;
    const mToRaw = seqMap[ref].to != null ? pos(seqMap[ref].to) : extent;
    const mTo = mToRaw > mFrom ? mToRaw : extent > mFrom ? extent : mFrom;
    // …then the EVENT's, intersected as an audio placement's is, and with no fallback (docs/graphModel.md).
    const eFrom = p.from != null ? pos(p.from) : null;
    const eTo = p.to != null ? pos(p.to) : null;
    const wFrom = Math.max(mFrom, eFrom ?? 0);
    const wTo = Math.max(wFrom, eTo != null ? Math.min(mTo, eTo) : mTo);
    const win = wTo - wFrom;
    // A written `to` off the extent cuts a tail or pads past the last hit, and either is worth a loop range.
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

// `params` as the engine takes them: numbers only, a file-valued one leaving as `namFile` instead (docs/graphModel.md).
function numericParams(
  params: Record<string, number | string> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params ?? {}))
    if (typeof v === "number") out[k] = v;
  return out;
}

// A module's DSP graph, from the JS/TS source it declares with `jsdsp:`, run in a child process — see docs/graphModel.md.
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
    // Normalised BEFORE both the write and the return, so a fresh compile and a later cache hit yield the same string.
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

// A module's Faust source as text: no build step, because the compiler is on the engine's side — see docs/faustModules.md.
function readFaustSource(source: string): string | undefined {
  try {
    return readFileSync(source, "utf8") || undefined;
  } catch {
    return undefined;
  }
}

// What a render's clip id ends with — a RESERVED suffix, because the compiled doc has no other way to say it (docs/freeze.md).
export const FROZEN_CLIP_SUFFIX = "__frozen";
export const isFrozenClipId = (id: string): boolean =>
  id.endsWith(FROZEN_CLIP_SUFFIX);

// The one clip a frozen track plays; `length: 0` tells the engine to use the file's natural length (docs/freeze.md).
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

// The engine's monitor vocabulary; anything else (including absent) is "auto", and a boolean maps onto the ends.
function normMonitor(v: unknown): string {
  if (typeof v === "boolean") return v ? "on" : "off";
  return v === "off" || v === "on" ? v : "auto";
}

// Input trim in dB. Non-finite (or absent) is unity — a gain the file can't state is not a reason to change one.
function normGain(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// A compile READS the project, so one walk of the module folders covers however often it asks the cache (moduleCache.ts).
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
  // Read WITH their issues: a rejected library module is dropped, and without its complaint the symptom is "extends unknown module".
  const refIssues: Diagnostic[] = [];
  const moduleRefs = loadModuleRefs(dir, undefined, refIssues); // the `extends` vocabulary
  // The LANES, before the chains, folded from the local modules alone — see docs/graphModel.md.
  const lanesMap = lanesOf(resolveModuleMap(localModules, moduleRefs));
  const chains: Record<string, Chain> = parseChains(
    rawChains,
    (n) => n in lanesMap,
  ); // keyed by each head's resolved name
  // A lane's MUTE, from the one place a bypass is written.
  const bypassed = bypassedOf(rawChains);
  // Kept apart from `bypassed` on purpose: one says the module is off, the other where the signal goes.
  const busOnly = busOnlyOf(rawChains);
  // Read WITH their issues: a rejected clip is dropped from the map, and its own complaint is what stops the ref reading as "not found".
  const clipsRead = readYamlEntities(dir, "clips");
  const clipsMap = clipsRead.values as Record<string, RawClip>;
  const seqMap = exportSub(dir, "sequences");
  // Plus the shared modules the chains name by ref, resolved ONCE so the compile loop below reads plain fields.
  const modulesMap = resolveModuleMap(
    withChainModuleRefs(localModules, moduleRefs, chains),
    moduleRefs,
  );

  // Unresolved references fail loudly rather than being silently dropped — see docs/nodeProject.md.
  const refErrs: string[] = [];
  for (const [, c] of Object.entries(chains))
    for (const step of c.use) {
      const moduleName = String(step?.module ?? "");
      const module = modulesMap[moduleName];
      // A missing module is NOT fatal: it compiles to nothing, like a bypassed step, and the graph draws a `?`.
      if (!module) continue;
      const ext = String(module.extends ?? "");
      if (ext && !moduleRefs[ext]) {
        // On disk but unreadable is a different fault from absent, and only the file's own complaint says which line is wrong.
        const broke = refIssues.find((i) => i.file.startsWith(`${ext}/`));
        refErrs.push(
          broke
            ? `module '${moduleName}': extends '${ext}', which ${broke.message}`
            : `module '${moduleName}': extends unknown module '${ext}'`,
        );
      }
    }
  for (const [trackId, t] of Object.entries(lanesMap))
    for (const p of t.events) {
      const ref = String(p?.ref ?? "");
      if (!ref) continue;
      const clip = clipsMap[ref];
      const seq = seqMap[ref];
      if (!clip && !seq) {
        // A file that EXISTS but failed to load is reported with its own complaint instead of "not found".
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

      // Repeating needs a known end, so an audio clip placed with a loop must say `to` — see docs/graphModel.md.
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

  // `video_tracks/` is deliberately unchecked here — the picture compiles separately (packages/song-video/docs/picture.md).

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
  for (const c of Object.values(chains))
    for (const { to } of outTargets(c))
      if (!isSink(to) && chains[to] && !isTrackFed(chains[to]))
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

  // The track id a chain contributes to: its source track, its own bus track, or its own INPUT
  // track — all three being the chain's own NAME.
  const ownerOf = (name: string, c: Chain): string =>
    isMasterChain(c)
      ? MASTER_OWNER
      : isTrackFed(c) || busChains.has(name) || inputChains.has(name)
        ? name
        : "";

  // --- FROZEN points: a `frozen:` module stands in for everything upstream of it (docs/freeze.md) ---
  const plans = activeFreezePlans(
    chains,
    modulesMap,
    (n) => n in lanesMap,
    (r) => existsSync(resolve(dir, r)),
  );
  const frozenLanes = new Set(plans.flatMap((p) => [...p.lanes]));
  const frozenPlugins = new Set(plans.flatMap((p) => [...p.modules]));
  // Which track plays each render: the one the frozen module's own chain compiles onto, whichever shape it is.
  const renderOn = new Map<string, string>();
  for (const p of plans)
    for (const [name, c] of Object.entries(chains))
      if (c.use.some((s) => s.module === p.at)) {
        const owner = ownerOf(name, c);
        if (owner) renderOn.set(owner, resolve(dir, p.render));
      }

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

  const trackPlugins: Record<string, PluginDoc[]> = {};
  const trackSends: Record<string, SendDoc[]> = {};
  // Collected here, baked into breakpoints below once the song's length (for LFO sampling) is known.
  const rawAutomations: {
    owner: string;
    pluginId: string;
    param: string;
    curve: string;
    // The module whose note-ons retrigger the curve, its own unless the binding names another; only an ADSR reads it.
    trigger: string;
  }[] = [];
  for (const [name, c] of Object.entries(chains)) {
    const owner = ownerOf(name, c);
    if (!owner) continue; // a chain that neither feeds a track nor is a used bus
    for (const step of c.use) {
      // Inside a render: skipped before the automations too, since a curve driving an absent plugin bakes a dead id.
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
            curve: curveIdFromRef(String(a.curve)),
            trigger: String(a.trigger ?? step.module),
          });
      if (!module) continue; // dangling module ref — already reported by the ref-check loop
      if (module.kind !== "plugin") continue; // an io module contributes no track processor
      // A rack compiles to a SamplerPlugin, checked BEFORE plugin.type since a rack module carries no `plugin`.
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
      // Only a KNOWN format reaches the engine; a word this gate does not know is dropped SILENTLY (docs/graphModel.md).
      const rawType = String(plugin?.type ?? "").toLowerCase();
      // `offline` is skipped on PURPOSE: such a module has no engine plugin, its pass writes to disk first (docs/coldModules.md).
      if (rawType === OFFLINE_TYPE) continue;
      if (
        rawType !== "internal" &&
        rawType !== JSDSP_TYPE &&
        rawType !== FAUST_TYPE &&
        !EXTERNAL_PLUGIN_FORMATS.has(rawType)
      )
        continue;
      // The type FOLDER is what picks a jsdsp graph's host — a transformer's runs over the notes.
      const { type, name: pluginName } = enginePlugin(
        plugin,
        step.module,
        moduleEmits(
          module.category,
          module.io as string | undefined,
          module.outputs,
        ),
      );
      if (!type) continue; // internal missing its name
      // Named by what this step IS, so a node saves beside its own file; a flat node carries its own folder (`home`).
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
        // The plugin's real name, so the engine can match it in the scan cache; a built-in falls back to the module name.
        name: pluginName,
        path: String(module.preset ?? ""), // resolved preset to load
        // The .nam model, absolute, leaving as its OWN field because the engine loads it rather than setting it.
        ...(module.nam ? { namFile: String(module.nam) } : {}),
        // The DSP graph, inline because the engine parses no files and this declares the plugin's parameters.
        ...(() => {
          const src = module.jsdsp;
          if (!src) return {};
          const json = readJsDspGraph(String(src));
          return json ? { dspGraph: json } : {};
        })(),
        // The Faust source, likewise inline, and a plain read: the compiler is in the ENGINE, so nothing here memoises.
        ...(() => {
          const src = module.faust;
          if (!src) return {};
          const text = readFaustSource(String(src));
          return text ? { faustDsp: text } : {};
        })(),
        // The feeder of the module's SECOND input port, as a lane; only the first is carried — see docs/ports.md.
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

  // An io "in" module is wired by the CHAIN it sits in, and the engine's model is the reverse, so each collapses onto its track.
  const inputOf: Record<
    string,
    { channels: number[]; monitor: string; gain: number }
  > = {};
  for (const [name, c] of Object.entries(chains)) {
    // The INPUT first, then the track it lands on: the other way round skipped every chain with no owner.
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

  // The soloed lanes from project.yaml's `soloed:`, a group's id folded onto its members because the engine never sees grouping.
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

  // One entry per HALF, ordered over the LANES so both halves stay adjacent — see docs/trackKind.md.
  const laneErrs: string[] = [];
  const tracks: TrackDoc[] = orderTracks(
    Object.entries(lanesMap).filter(
      ([, t]) => t.type !== "group" && !t.disabled,
    ),
    ([id]) => id,
    root.trackOrder,
  ).flatMap(([lane, t]): TrackDoc[] => {
    const halves = halvesOf(lane);
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
            : // The lane's authored `events:` become the engine's `clips` — this line IS the boundary between the two words.
              events.map((p) =>
                placementToClip(dir, p, clipsMap, seqMap, num, den, tempo),
              ),
        plugins: trackPlugins[id] ?? [],
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

  // A channel per lane-less INPUT run: what a rig you play through is made of. No clips — what is
  // heard is what is plugged in — and `regular` rather than `effect`, since it is not a return.
  for (const name of inputChains) {
    const inp = inputOf[name];
    tracks.push({
      id: name,
      name,
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
    });

  // Every note-on a lane plays, in song beats, sorted and deduplicated — see docs/graphModel.md.
  const noteOns = (track: TrackDoc | undefined): number[] => {
    if (!track) return [];
    const out: number[] = [];
    for (const c of track.clips) {
      if (c.type !== "midi") continue;
      const loop = c.loopEnd > c.loopStart ? c.loopEnd - c.loopStart : 0;
      const span = c.length > 0 ? c.length : Number.POSITIVE_INFINITY;
      for (const n of c.notes) {
        if (loop > 0) {
          if (n.time < c.loopStart || n.time >= c.loopEnd) continue;
          for (let k = 0; k * loop < span; k++) {
            const at = n.time - c.loopStart + k * loop;
            if (at >= span) break;
            out.push(c.start + at);
          }
        } else if (n.time < span) {
          out.push(c.start + n.time);
        }
      }
    }
    return [...new Set(out.map((b) => Math.round(b * 1e6) / 1e6))].sort(
      (a, b) => a - b,
    );
  };

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
    // Which lane plays each module, built from the same chains the automations were read off so the two cannot disagree.
    const laneOfModule = new Map<string, string>();
    for (const [name, c] of Object.entries(chains)) {
      const owner = ownerOf(name, c);
      if (owner) for (const step of c.use) laneOfModule.set(step.module, owner);
    }
    for (const ra of rawAutomations) {
      const curve = curvesMap[ra.curve];
      const track = byId.get(ra.owner);
      if (!curve || !track) continue;
      // An envelope is placed by its EVENTS; every other curve is a function of song time (docs/graphModel.md).
      const baked =
        curve.type === "adsr"
          ? bakeAdsr(
              curve,
              noteOns(byId.get(laneOfModule.get(ra.trigger) ?? ra.owner)),
              tempo,
            )
          : bakeCurve(curve, num, den, songBeats);
      if (!baked.points.length) continue;
      track.automation.push({
        param: ra.param,
        pluginId: ra.pluginId,
        bipolar: baked.bipolar,
        points: baked.points,
      });
    }
  }

  // PICTURE IS NOT HERE: the same folder compiles twice, and this is the pass the C++ engine reads (packages/song-video/docs/picture.md).

  return {
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
    // Read off the AUTHORED lanes — a strudel lane compiles to an empty one, so by then the fact it streams is gone.
    strudel: Object.values(lanesMap).some((t) => t.type === "strudel"),
    markers: parseMarkers(root.markers, num || 4, den || 4),
    // settings.yaml is a flat root file, loaded on its own and validated as it is read (a bad value fails the compile).
    settings: parseSettings(loadSettings(dir, true)),
  };
}
