// nodeProject.ts — compile a chains/modules node project (a graph) into the flat
// tracks-with-clips-and-plugins ProjectDoc the engine plays: each track becomes a lane,
// each chain's `use` steps become that track's plugins in order.
// Full rationale: docs/nodeProject.md.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bakeCurve, loadCurves } from "./curves";
import {
  type Chain,
  checkChainInputs,
  frozenRender,
  inputLandingTrack,
  parseChains,
} from "./graph";
import {
  exportSub,
  isVideoSource,
  loadChains,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  loadSettings,
  loadTracks,
  loadVideoTracks,
  readYamlEntities,
  withChainModuleRefs,
} from "./loader";
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
  ShapeDoc,
  TrackDoc,
  VideoClipDoc,
  VideoTrackDoc,
} from "./project";
import {
  EXTERNAL_PLUGIN_FORMATS,
  enginePlugin,
  MIXER_PLUGIN,
  parseMarkers,
  parseSettings,
} from "./project";
import type {
  RawClip,
  RawPlacement,
  RawSequence,
  RawVideoPlacement,
} from "./rawDoc";
import { parseDuration, parsePosition } from "./timecode";
import { sortTracksByKind } from "./trackKind";

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
    const from = edge(cm.from);
    const to = edge(cm.to);
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
     * a MIDI clip ignores `offset` (see insertMidiClip). A window starting at the first beat and played once
     * needs no range at all — the clip's own end already stops it at `to` — so it is left unset there rather
     * than written as a loop that must never come round.
     */
    // The default `to`, when the file says none: the notes' extent rounded UP TO THE BAR. Not the bare extent —
    // a two-bar drum pattern whose last hit is on the fourth sixteenth would otherwise be 3.75 beats long, and
    // every repeat of it would drift. Material is written in bars; a sequence that means otherwise says `to`.
    const bar = (num * 4) / den;
    const extent =
      Math.ceil(
        notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0) / bar,
      ) * bar;
    const wFrom = seqMap[ref].from != null ? pos(seqMap[ref].from) : 0;
    const wToRaw = seqMap[ref].to != null ? pos(seqMap[ref].to) : extent;
    const wTo = wToRaw > wFrom ? wToRaw : extent > wFrom ? extent : wFrom;
    const win = wTo - wFrom;
    return {
      ...base,
      type: "midi",
      notes,
      length: win * loops,
      ...(win > 0 && (loops > 1 || wFrom > 0)
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

// The one clip a frozen track plays: the render, from bar 1, for as long as it lasts. `length: 0` is not "empty" —
// it is how the engine is told to use the file's natural length (see clipPositionFor), which is the only right
// answer here, since the render was bounced from this very song and already ends where it ends.
function frozenClip(id: string, source: string): ClipDoc {
  return {
    id: `${id}__frozen`,
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

// A video placement -> a VideoClipDoc, in plain DECIMAL SECONDS: the tempo map never reaches picture.
function videoPlacementToClip(
  dir: string,
  p: RawVideoPlacement,
  clipsMap: Record<string, RawClip>,
): VideoClipDoc {
  const ref = String(p.ref ?? "");
  return {
    id: ref,
    name: ref,
    source: clipsMap[ref] ? resolve(dir, String(clipsMap[ref].source)) : "",
    start: Number(p.start ?? 0),
    length: Number(p.length ?? 0),
    sourceFrom: Number(p.source_from ?? 0),
  };
}

// One shape -> a ShapeDoc in viewport px; the fill reads `background_color` or `color`, each the other's fallback.
function compileShape(s: Record<string, unknown>): ShapeDoc {
  const x = Number(s.x ?? 0);
  const y = Number(s.y ?? 0);
  const fill = String(s.background_color ?? s.color ?? "#ffffff");
  switch (s.type) {
    case "circle":
      return { type: "circle", x, y, r: Number(s.r ?? 0), color: fill };
    case "text":
      return {
        type: "text",
        content: String(s.content ?? ""),
        font: String(s.font ?? "sans-serif"),
        fontSize: Number(s.font_size ?? s.fontSize ?? 24),
        x,
        y,
        ...(s.w != null ? { w: Number(s.w) } : {}),
        color: String(s.color ?? s.background_color ?? "#ffffff"),
      };
    default: // "square"
      return {
        type: "square",
        x,
        y,
        w: Number(s.w ?? 0),
        h: Number(s.h ?? 0),
        color: fill,
      };
  }
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

export function compileNodeProject(dir: string): ProjectDoc {
  // The rig, not the song — unreadable preferences mean no labels resolve, never a failed compile.
  let prefs: Preferences;
  try {
    prefs = loadPreferences();
  } catch {
    prefs = defaultPreferences();
  }
  const root = loadProjectRoot(dir, true); // the root file -> project, markers
  const chains: Record<string, Chain> = parseChains(
    loadChains(dir, root, true),
  ); // keyed by each head's resolved name; duplicates rejected
  const localModules = loadModules(dir, true); // validated as read — this doc feeds the engine
  const tracksMap = loadTracks(dir, true); // enforced: a bad track fails the compile
  // Read WITH their issues: a clip file the schema rejects is dropped from the map, and without this the only
  // symptom is the track's ref reading as "not found" — which sends you looking for a missing file that is
  // sitting right there. The file's own complaint is the answer, so it has to survive to the report below.
  const clipsRead = readYamlEntities(dir, "clips");
  const clipsMap = clipsRead.values as Record<string, RawClip>;
  const seqMap = exportSub(dir, "sequences");
  const videoTracksMap = loadVideoTracks(dir, true);
  const moduleRefs = loadModuleRefs(dir, root.project?.modules_from ?? []); // the `extends` vocabulary
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
      if (ext && !moduleRefs[ext])
        refErrs.push(`module '${moduleName}': extends unknown module '${ext}'`);
    }
  for (const [trackId, t] of Object.entries(tracksMap))
    for (const p of Array.isArray(t?.clips) ? t.clips : []) {
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
  for (const [trackId, t] of Object.entries(tracksMap))
    if (t?.type === "strudel" && t.strudel)
      if (!existsSync(resolve(dir, String(t.strudel))))
        refErrs.push(
          `track '${trackId}': strudel pattern '${t.strudel}' file missing`,
        );

  // Video placements, mirroring the audio pass — plus a re-check that the source really is a video.
  for (const [trackId, t] of Object.entries(videoTracksMap))
    for (const p of Array.isArray(t?.clips) ? t.clips : []) {
      const ref = String(p?.ref ?? "");
      if (!ref) continue;
      const clip = clipsMap[ref];
      if (!clip) {
        refErrs.push(`video track '${trackId}': clip '${ref}' not found`);
      } else if (!existsSync(resolve(dir, String(clip.source ?? "")))) {
        refErrs.push(
          `video track '${trackId}': clip '${ref}' file missing (${clip.source ?? "?"})`,
        );
      } else if (!isVideoSource(String(clip.source))) {
        refErrs.push(
          `video track '${trackId}': clip '${ref}' is not a video (${clip.source}) — a video track takes video clips only`,
        );
      }
    }

  // `video_source` names the VIDEO track an audio track takes its placements from — declared on the lane described.
  for (const [trackId, t] of Object.entries(tracksMap)) {
    const src = String(t?.video_source ?? "");
    if (!src) continue;
    if (t.type === "group" || t.type === "strudel")
      refErrs.push(
        `track '${trackId}': video_source is for a single audio track, not a ${t.type === "group" ? "group" : "strudel lane"}`,
      );
    else if (t.contentType === "sequences")
      refErrs.push(
        `track '${trackId}': video_source '${src}' — a sequences track carries MIDI, not audio`,
      );
    // Own clips AND an inherited list would be two sources of truth, the inherited one silently winning — say so instead.
    else if (Array.isArray(t.clips) && t.clips.length)
      refErrs.push(
        `track '${trackId}': video_source '${src}' replaces this track's clips — remove its own ${t.clips.length} placement(s), or drop video_source`,
      );
    else if (!videoTracksMap[src])
      refErrs.push(
        `track '${trackId}': video_source '${src}' — video track not found`,
      );
    else if (videoTracksMap[src].kind === "shape")
      refErrs.push(
        `track '${trackId}': video_source '${src}' is a shape track — it draws fills, it has no clips to take audio from`,
      );
  }

  if (refErrs.length)
    throw new Error(`unresolved reference(s):\n  - ${refErrs.join("\n  - ")}`);

  // Reject a project whose chains don't feed their modules' declared input ports.
  const inputErrs = checkChainInputs(
    chains,
    modulesMap,
    tracksMap,
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
  const isTrackFed = (c: Chain) => !!c.from && !!tracksMap[c.from];

  // Non-sink targets naming a chain that isn't track-fed: routing into a track's input is inexpressible, so they drop.
  const busChains = new Set<string>();
  for (const c of Object.values(chains))
    for (const { to } of outTargets(c))
      if (!isSink(to) && chains[to] && !isTrackFed(chains[to]))
        busChains.add(to);

  // The track id a chain contributes to: its source track, or its own bus track.
  const ownerOf = (name: string, c: Chain): string =>
    isTrackFed(c) ? String(c.from) : busChains.has(name) ? name : "";

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
      const rawType = String(plugin?.type ?? "").toLowerCase();
      if (rawType !== "internal" && !EXTERNAL_PLUGIN_FORMATS.has(rawType))
        continue;
      const { type, name: pluginName } = enginePlugin(plugin, step.module);
      if (!type) continue; // internal missing its name
      // Named by what this step IS, so an instance saves beside its own file and never overwrites a sibling's state.
      const presetSave = join(
        dir,
        "modules",
        String(module.category),
        String(module.file ?? step.module),
        `${String(module.instance ?? module.file ?? step.module)}.vstpreset`,
      );
      (trackPlugins[owner] ??= []).push({
        id: `${name}:${step.module}`,
        type, // engine wire form: built-in xmlTypeName (e.g. "4osc") or external format ("vst3")
        // The plugin's real name so the engine can match it in the scan cache to load an
        // external plugin; a built-in falls back to the module name (see enginePlugin).
        name: pluginName,
        path: String(module.preset ?? ""), // resolved preset to load
        // Library files (an IR, a .nam model), absolute; inherited like the preset, omitted entirely when there is none.
        ...(module.ir ? { irFile: String(module.ir) } : {}),
        ...(module.nam ? { namFile: String(module.nam) } : {}),
        // The DSP graph, built here and carried inline: the engine parses no files, and this one declares the
        // plugin's parameters, so it has to be in the doc rather than fetched later.
        ...(() => {
          const src = module.jsdsp;
          if (!src) return {};
          const json = readJsDspGraph(String(src));
          return json ? { dspGraph: json } : {};
        })(),
        presetSave,
        role: "",
        enabled: c.enabled !== false && step.enabled !== false,
        params: module.params ?? {}, // resolved, so this is exactly what the graph shows
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
  for (const [id, t] of Object.entries(tracksMap))
    if (t?.type === "group")
      for (const m of Array.isArray(t.tracks) ? t.tracks : [])
        groupOf[String(m)] = id;

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
      ownerOf(name, c) || inputLandingTrack(c, (id) => !!tracksMap[id]);
    if (!track || inputOf[track]) continue;
    inputOf[track] = {
      // The seam cast: `channel` passed the module schema (a label or channel list).
      channels: resolveInput(b.channel as string | number[] | undefined, prefs)
        .channels,
      monitor: normMonitor(b.monitor),
      gain: normGain(b.gain),
    };
  }

  const groups: GroupDoc[] = Object.entries(tracksMap)
    .filter(([, t]) => t?.type === "group" && !t?.disabled)
    .map(([id, t]) => ({
      id,
      name: String(t.name ?? id),
      color: String(t.color ?? ""),
      mute: !!t.mute,
      solo: !!t.solo,
    }));

  // Which tracks are frozen IN FACT — resolved once, because both the clip list and the plugin list below turn on
  // it and they must not be able to disagree. A `frozen:` naming a render that isn't there resolves to undefined
  // and the track compiles live (see frozenRender for why that isn't an error).
  const frozen: Record<string, string | undefined> = {};
  for (const [id, t] of Object.entries(tracksMap))
    frozen[id] = frozenRender(dir, t);

  // A strudel lane compiles to an EMPTY track carrying its chain's plugins — what the
  // engine should hold when stopped; patternClock fills its clips while rolling.
  // Sorted by instrument family here, on the compiled doc, so every surface and the
  // engine agree on what "the third track" is (see trackKind.ts).
  const tracks: TrackDoc[] = sortTracksByKind(
    Object.entries(tracksMap).filter(
      ([, t]) => t?.type !== "group" && !t?.disabled,
    ),
    ([id, t]) => String(t.name ?? id),
  ).map(
    ([id, t]): TrackDoc => ({
      id,
      name: String(t.name ?? id),
      role: "regular",
      contentType: t.contentType === "sequences" ? "notes" : "audio", // the engine's vocabulary
      group: groupOf[id] ?? "",
      generated: t?.type === "strudel",
      color: String(t.color ?? ""),
      mute: !!t.mute,
      solo: !!t.solo,
      disabled: false, // filtered out above
      // From the io "in" module that names this track, if any (see inputOf above).
      inputChannels: inputOf[id]?.channels ?? [],
      monitor: inputOf[id]?.monitor ?? "auto",
      inputGain: inputOf[id]?.gain ?? 0,
      // A FROZEN track plays its render and nothing else: one audio clip at bar 1, natural length, and no
      // plugins — every module of its chains is already inside the wav, so running them again would be the amp
      // twice. Its material stays in the file untouched, waiting for the unfreeze.
      //
      // Volume, pan and sends deliberately stay live, which is what makes a frozen track still mixable: the
      // render was bounced with them neutralised (see the freeze command), so they apply exactly once, here,
      // the same way they did before. The freeze boundary the render stops at needs no computing either — a
      // bus's modules were never on this track's plugin list; they live on the bus's own return track, so
      // "up to OUT or to a module with several inputs" is simply what `trackPlugins[id]` already means.
      clips: frozen[id]
        ? [frozenClip(id, frozen[id] as string)]
        : (t.clips ?? []).map((p) =>
            placementToClip(dir, p, clipsMap, seqMap, num, den, tempo),
          ),
      // A frozen track keeps its STRIP and nothing else: the render already contains every module that shaped
      // the sound, but a lane you cannot set the level of is not mixable, which is the one thing freezing
      // promises to leave alone. The render was bounced with the strip flattened (see freezeTrackRender), so it
      // applies exactly once, here, the way it did before.
      plugins: frozen[id]
        ? (trackPlugins[id] ?? []).filter((p) => p.type === MIXER_PLUGIN)
        : (trackPlugins[id] ?? []),
      sends: trackSends[id] ?? [],
      automation: [],
      // Carried through for surfaces, omitted when unset so they never widen the playable model.
      ...(typeof t.docs === "string" ? { docs: t.docs } : {}),
      ...(Array.isArray(t.todos)
        ? { todos: t.todos.map(String).filter((s) => s) }
        : {}),
      ...(frozen[id] ? { frozen: frozen[id] as string } : {}),
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
      solo: false,
      disabled: false,
      clips: [],
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

  // --- picture ---------------------------------------------------------------
  // video_tracks/ -> VideoTrackDoc[] in project.layers order (bottom first), plus three checks the schema can't make.
  const video = !!proj.video;
  const videoTrackIds = Object.keys(videoTracksMap);
  const layers = (Array.isArray(proj.layers) ? proj.layers : []).map(String);
  const videoErrs: string[] = [];

  // A whole folder ignored would be a silent surprise — say so instead.
  if (!video && videoTrackIds.length)
    videoErrs.push(
      `video_tracks/ has ${videoTrackIds.length} track(s) but project.video is false — set video: true and a viewport in project.yaml`,
    );

  if (video) {
    const known = new Set(videoTrackIds);
    const listed = new Set<string>();
    for (const id of layers) {
      if (!known.has(id))
        videoErrs.push(
          `project.layers names '${id}', which is not a video track (add video_tracks/${id}.yaml, or remove it from layers)`,
        );
      if (listed.has(id))
        videoErrs.push(`project.layers lists '${id}' more than once`);
      listed.add(id);
    }
    // A track absent from layers would silently never draw — an error, not a no-op.
    for (const id of videoTrackIds)
      if (!listed.has(id))
        videoErrs.push(
          `video track '${id}' is missing from project.layers (add it — layers decides draw order, bottom first)`,
        );
  }

  if (videoErrs.length)
    throw new Error(`video config invalid:\n  - ${videoErrs.join("\n  - ")}`);

  // In layers order (validated complete above), so the renderer draws bottom-first with no re-sort.
  const videoTracks: VideoTrackDoc[] = (video ? layers : []).map(
    (id: string) => {
      const t = videoTracksMap[id] ?? {};
      const kind = t.kind === "shape" ? "shape" : "video";
      return {
        id,
        name: String(t.name ?? id),
        color: String(t.color ?? ""),
        mute: !!t.mute,
        kind,
        x: Number(t.x ?? 0),
        y: Number(t.y ?? 0),
        w: Number(t.w ?? 0),
        h: Number(t.h ?? 0),
        // Only the matching field is read downstream, so the other stays empty.
        clips:
          kind === "video"
            ? (Array.isArray(t.clips) ? t.clips : []).map((p) =>
                videoPlacementToClip(dir, p, clipsMap),
              )
            : [],
        shapes:
          kind === "shape"
            ? (Array.isArray(t.shapes) ? t.shapes : []).map((sh) =>
                compileShape((sh ?? {}) as Record<string, unknown>),
              )
            : [],
      };
    },
  );

  // The same cut played as AUDIO — only the unit changes, so a shot and its sound can't drift.
  const videoClipAsAudio = (vc: VideoClipDoc): ClipDoc => ({
    id: vc.id,
    type: "audio",
    name: vc.name,
    source: vc.source,
    start: (vc.start * tempo) / 60,
    length: vc.length > 0 ? (vc.length * tempo) / 60 : 0,
    offset: (vc.sourceFrom * tempo) / 60,
    fadeIn: 0,
    fadeOut: 0,
    loopStart: 0,
    loopEnd: 0,
    notes: [],
  });

  // Resolved against the AUTHORED video tracks: neither project.layers nor `video: false` gates inherited audio.
  for (const t of tracks) {
    const src = String(tracksMap[t.id]?.video_source ?? "");
    if (!src) continue;
    const vt = videoTracksMap[src];
    if (!vt) continue; // already validated above — defensive
    t.clips = (Array.isArray(vt.clips) ? vt.clips : [])
      .map((p) => videoPlacementToClip(dir, p, clipsMap))
      .map(videoClipAsAudio);
  }

  // viewport is [w, h] with an optional third element for export fps (default 30).
  const vp = Array.isArray(proj.viewport) ? proj.viewport.map(Number) : [];
  const viewport: [number, number] = video ? [vp[0] || 0, vp[1] || 0] : [0, 0];
  const fps = vp[2] && vp[2] > 0 ? Number(vp[2]) : 30;

  return {
    name: String(proj.name ?? "untitled"),
    tempo,
    sampleRate: Number(proj.sampleRate ?? 48000),
    timeSigNumerator: num || 4,
    timeSigDenominator: den || 4,
    recordDir: "", // set by loadProject, which is what knows this is a folder project
    tracks,
    groups,
    // Read off the AUTHORED tracks — a strudel lane compiles to an empty one, so by then the fact it streams is gone.
    strudel: Object.values(tracksMap).some((t) => t?.type === "strudel"),
    video,
    viewport,
    fps,
    videoTracks,
    markers: parseMarkers(root.markers, num || 4, den || 4),
    // settings.yaml is a flat, package-less root file (not part of `root` above) — load
    // it on its own, validated as it is read (a bad value fails the compile).
    settings: parseSettings(loadSettings(dir, true)),
  };
}
