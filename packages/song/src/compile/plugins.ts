// compile/plugins.ts — a chain's steps compiled to the engine's plugins: a rack to a sampler,
// a known plugin format to its PluginDoc with the blend and levels the engine holds, and the
// curves bound to them baked into automation. What a reader gets wrong: an unknown plugin type
// is dropped SILENTLY, where a module stating a held param is refused. docs/nodeProject.md.

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  curveIdFromRef,
  INPUT_VOLUME_PARAM,
  MIX_PARAM,
  moduleEmits,
  OUTPUT_VOLUME_PARAM,
} from "@studio/song-schema/moduleTypes";
import { isSurgePatch } from "../basePreset";
import { confineTo } from "../confine";
import { envelopeFires } from "../curveConditions";
import { bakeAdsr, bakeCurve, loadCurves } from "../curves";
import { faustFilesOf } from "../faustFiles";
import { resolvedRack, resolvedType } from "../moduleResolve";
import {
  heldParams,
  ownsBlend,
  takesInputVolume,
  takesOutputVolume,
} from "../ownMix";
import type { PluginDoc, RackSoundDoc, SendDoc, TrackDoc } from "../project";
import {
  EXTERNAL_PLUGIN_FORMATS,
  enginePlugin,
  FAUST_TYPE,
  JSDSP_TYPE,
  OFFLINE_TYPE,
} from "../project";
import { tapOutsFor } from "../tapOuts";
import { wsExists, wsRead, wsWrite } from "../yaml/workspaceFile";
import type { CompileInputs } from "./inputs";
import type { ChainOwnership } from "./ownership";

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
  if (!wsExists(source)) return undefined;
  const built = `${source.replace(/\.[tj]sx?$/, "")}.json`;
  const fresh =
    wsExists(built) && statSync(built).mtimeMs >= statSync(source).mtimeMs;
  if (fresh) {
    try {
      const text = wsRead(built);
      JSON.parse(text);
      return text;
    } catch {
      /* the cache is corrupt — fall through and rebuild it */
    }
  }
  try {
    const runner = fileURLToPath(new URL("../dspRunner.mjs", import.meta.url));
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", runner, source],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
    JSON.parse(out); // refuse to cache something the engine could not read
    // Normalised BEFORE both the write and the return, so a fresh compile and a later cache hit yield the same string.
    const text = out.endsWith("\n") ? out : `${out}\n`;
    wsWrite(built, text);
    return text;
  } catch {
    // Keep playing what last worked rather than going silent on a typo.
    if (wsExists(built)) {
      try {
        return wsRead(built);
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
    return wsRead(source) || undefined;
  } catch {
    return undefined;
  }
}

/** Every chain's steps compiled to the plugins and sends of the track that owns them. */
export function compilePlugins(
  dir: string,
  inp: CompileInputs,
  own: ChainOwnership,
  frozenPlugins: Set<string>,
) {
  const { roots, chains, modulesMap, routedTaps } = inp;
  const { outTargets, busChains, ownerOf, sideInputTrack } = own;
  // The plugin each rack node became, for the tracks its taps feed.
  const pluginOfNode = new Map<string, string>();
  const trackPlugins: Record<string, PluginDoc[]> = {};
  // Each lane's module refs and types, the last word on its category when its name says none.
  const laneHints: Record<string, string[]> = {};
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
      // What the lane plays, in chain order, for a name that does not say its category itself (trackColor.ts).
      laneHints[owner] = [
        ...(laneHints[owner] ?? []),
        String(module.extends ?? ""),
        String(resolvedType(module) ?? ""),
      ];
      if (module.kind !== "plugin") continue; // an io module contributes no track processor
      // A rack compiles to a SamplerPlugin, checked BEFORE plugin.type since a rack module carries no `plugin`.
      if (resolvedType(module) === "rack") {
        const rack = resolvedRack(module);
        // Already absolute from resolveRackAudio; one outside the project's roots is no sound at all.
        const toAbs = (p: string | undefined): string =>
          p
            ? (confineTo(roots, isAbsolute(p) ? p : resolve(dir, p)) ?? "")
            : "";
        const sourceAbs = rack.rackType === "slice" ? toAbs(rack.source) : "";
        const sounds: RackSoundDoc[] = [];
        for (const [symbol, e] of Object.entries(rack.symbols)) {
          const note = Number(e.note);
          if (!Number.isFinite(note)) continue;
          // A muted tap stays on the kit and its pad; the sampler is simply not given it.
          if (e.mute === true) continue;
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
        const routed = routedTaps.get(step.module) ?? [];
        pluginOfNode.set(step.module, `${name}:${step.module}`);
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
          // Routed taps leave by pairs of their own (engine docs/tapOutputs.md).
          ...(routed.length
            ? {
                tapOuts: tapOutsFor(step.module, routed, (tap) => {
                  const n = rack.symbols[tap]?.note;
                  return n === undefined ? undefined : Number(n);
                }),
              }
            : {}),
        });
        continue;
      }

      // An effect's own dry/wet is the engine's to hold, so a module stating one is refused, not silently overridden — engine docs/mix.md.
      const held = heldParams(module, module.params);
      if (held.length)
        throw new Error(
          `module '${step.module}': params set ${held.map((n) => `'${n}'`).join(", ")} — the engine's own stage holds these: state the blend as \`mix:\` (0 all dry .. 1 all wet) and the levels as \`input_volume:\` / \`output_volume:\` (dB) instead, here or in the module it extends`,
        );
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
      const presetSave = module.presetRel
        ? join(dir, String(module.presetRel))
        : module.home
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
        // The resolved base to load: a `.vstpreset`, or a Surge XT patch, which leaves as its own field below.
        path: isSurgePatch(module.preset) ? "" : String(module.preset ?? ""),
        // The .nam model, absolute, leaving as its OWN field because the engine loads it rather than setting it.
        ...(module.model ? { namFile: String(module.model) } : {}),
        // …and the cabinet IR it convolves after the model, from a library's `irs/` (docs/libraryFiles.md).
        ...(module.ir ? { irFile: String(module.ir) } : {}),
        // An SFZ instrument, as the module names it: an `@instruments/` one is resolved on the ENGINE's machine.
        ...(typeof module.params?.sfz === "string" && module.params.sfz
          ? { sfzFile: module.params.sfz }
          : {}),
        // …and a kit's pads routed to subchains, by the notes its `kit:` names (engine docs/tapOutputs.md).
        ...(() => {
          const routed = routedTaps.get(step.module) ?? [];
          if (!routed.length) return {};
          pluginOfNode.set(step.module, `${name}:${step.module}`);
          return {
            tapOuts: tapOutsFor(
              step.module,
              routed,
              (tap) => module.kit?.[tap],
            ),
          };
        })(),
        // A Surge XT patch is a base like any other, loaded by the synth itself (engine docs/surgePlugin.md).
        ...(isSurgePatch(module.preset)
          ? { surgePatch: String(module.preset) }
          : {}),
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
          if (!text) return {};
          // …and the files its `soundfile` slots play, named by the node's string params (docs/faustFiles.md).
          const files = faustFilesOf(module.params, dir);
          return { faustDsp: text, ...(files ? { faustFiles: files } : {}) };
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
        params: {
          ...numericParams(module.params), // resolved, so this is exactly what the graph shows
          // The blend is the engine's, and ALWAYS sent for an effect that owns it: that is what tells the engine to hold the plugin's own at full wet.
          ...(ownsBlend(module)
            ? { [MIX_PARAM]: module.mix ?? 1 }
            : module.mix !== undefined
              ? { [MIX_PARAM]: module.mix }
              : {}),
          // …and the two levels, always for a module that has them: arriving is what holds the plugin's own.
          ...(takesInputVolume(module)
            ? { [INPUT_VOLUME_PARAM]: module.input_volume ?? 0 }
            : {}),
          ...(takesOutputVolume(module)
            ? { [OUTPUT_VOLUME_PARAM]: module.output_volume ?? 0 }
            : {}),
        },
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
  return { trackPlugins, laneHints, trackSends, rawAutomations, pluginOfNode };
}

/** The automations, baked once every track exists: an LFO is sampled over the song's length. */
export function bakeAutomations(
  dir: string,
  inp: CompileInputs,
  own: ChainOwnership,
  rawAutomations: ReturnType<typeof compilePlugins>["rawAutomations"],
  tracks: TrackDoc[],
  num: number,
  den: number,
  tempo: number,
): void {
  const { chains } = inp;
  const { ownerOf } = own;
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
      // The events of the node the curve drives — an envelope's triggers, and any curve's `event` condition.
      const events = noteOns(
        byId.get(laneOfModule.get(ra.trigger) ?? ra.owner),
      );
      // An envelope is placed by its EVENTS; every other curve is a function of song time, both under their conditions (docs/curves.md).
      const baked =
        curve.type === "adsr"
          ? bakeAdsr(
              curve,
              envelopeFires(curve.conditions, events, num, den),
              tempo,
            )
          : bakeCurve(curve, num, den, songBeats, events);
      if (!baked.points.length) continue;
      track.automation.push({
        param: ra.param,
        pluginId: ra.pluginId,
        bipolar: baked.bipolar,
        points: baked.points,
      });
    }
  }
}
