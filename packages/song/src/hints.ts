// hints.ts — a project's entities, structured for schema-aware autocompletion.
//
// Feeds the editor's completion source, its reference links, and the note editors' rack
// vocabulary. Every gather is wrapped so a broken project degrades to whatever loaded
// rather than throwing — completion on a half-written file is exactly when you need it.

import { type Dirent, existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { builtinParamsFor, type ParamRange } from "./builtinParams";
import { deriveChains } from "./chainsGraph";
import {
  baseModuleRefs,
  exportSub,
  isVideoSource,
  loadChains,
  loadLanes,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  loadVideoTracks,
} from "./loader";
import { assetLookup, moduleAssetChoices } from "./moduleAssetChoices";
import { resolvedRack, resolvedType, resolveModuleMap } from "./moduleResolve";
import { loadPreferences } from "./preferences";

export interface Hints {
  baseModules: string[]; // plugin module refs a module can `extends` ("type/name", "@ns/type/name")
  ioSinks: string[]; // io module names a chain can route TO ("OUT")
  // Chain `use` references: a module's bare name for the generic module.yaml, plus
  // "<name>:<node>" for each `<node>.yaml` beside it (see loader.ts NODE_SEP),
  // then the inherited modules by ref ("@ns/type/name").
  modules: string[];
  tracks: string[];
  // Input-channel labels from the MACHINE's preferences, not the project — an io
  // "in" module's `channel` names one of these (see preferences.resolveInput).
  channels: string[];
  clips: string[]; // every clip id (audio + video) — for the editor's link map
  audioClips: string[]; // clips whose source is NOT a video file
  videoClips: string[]; // clips whose source IS a video file
  // Video track ids (video_tracks/<id>.yaml) — what an audio track's `video_source` may
  // name to inherit that track's placements and play their audio.
  videoTracks: string[];
  sequences: string[];
  chains: string[];
  curves: string[]; // automation curve ids (curves/<id>.yaml) — for pinning a module's automations
  // What each module's file-valued params may be set to — its own `assets/` walked, as
  // assets-relative paths ("Two-Rock/Clean.nam"), keyed by the chain `use` ref. What the
  // panel's dropdown offers and what completes `module nam`. A module with no assets/ is
  // absent rather than empty.
  moduleAssets: Record<string, string[]>;
  paramsByBase: Record<string, string[]>; // base ref -> known param names (open — new ones still allowed)
  // …and what those params SPAN, for the bases whose plugin is a built-in we define (see builtinParams.ts). Only
  // a plugin knows its own range, and a widget bound without one is drawn 0..1 — wrong for a -60..+6 dB fader.
  // Absent for everything else: an external plugin reports its ranges live, and that report wins where it exists.
  paramMetaByBase: Record<string, Record<string, ParamRange>>;
  // Rack modules -> their effective (base+module) rack. Lets the note editors relabel
  // notes as symbols (and enter by symbol) when a sequence names the module via
  // use_rack, and — for a slice rack — draw the source clip's waveform with each
  // symbol's [from,to] window. Keyed by the chain `use` ref (so a node appears under
  // its own "<name>:<node>" key, with its own symbol overrides); only racks appear.
  racks: Record<
    string,
    {
      rackType: "samples" | "slice";
      source?: string; // slice: the clip id every symbol slices from
      symbols: { symbol: string; note: number; from?: number; to?: number }[];
    }
  >;
  keywords: string[]; // words YAML gives meaning to
  // Scanned plugin names grouped by format (lowercased key). E.g. `{ vst3: ["Serum"],
  // au: ["Massive"] }`. Populated by the file service from the engine's scan cache
  // (~/.studio/exts.json); the brain's projectHints() returns an empty record.
  pluginNames: Record<string, string[]>;
  // "kind:name" -> the project-relative file that defines the entity, so the
  // editor can turn a known reference into a link. kind ∈ module|base|sink|
  // track|clip|sequence|chain (chains all live in chains.yaml).
  paths: Record<string, string>;
  // Audio files in the project, keyed by their project-relative FOLDER ("" = the root) —
  // so a rack's `source:` (or a samples symbol's `clip:`) completes against the audio
  // sitting beside it. Filenames only (what the field holds).
  media: Record<string, string[]>;
}

const AUDIO_EXT = [
  ".wav",
  ".aif",
  ".aiff",
  ".flac",
  ".mp3",
  ".ogg",
  ".m4a",
  ".opus",
];

// Every audio file in the project, grouped by its project-relative folder. A shallow raw-fs
// walk (names, not contents) — separate from the entity gathers above because these files
// aren't entities; they live beside them (a rack's samples, a clip's source).
function scanMedia(dir: string): Record<string, string[]> {
  const media: Record<string, string[]> = {};
  const walk = (abs: string, rel: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip rather than fail the whole gather
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // dotfiles / dot-dirs
      if (e.isDirectory())
        walk(join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
      else if (AUDIO_EXT.includes(extname(e.name).toLowerCase()))
        (media[rel] ??= []).push(e.name);
    }
  };
  walk(dir, "");
  for (const files of Object.values(media)) files.sort();
  return media;
}

// The words YAML itself gives meaning to, offered so they can be completed rather than
// mistyped — `on`/`off`/`yes`/`no` are the ones that bite, since YAML 1.1 read them as
// booleans and a plugin called "on" has to be quoted.
const YAML_KEYWORDS = ["true", "false", "null", "on", "off", "yes", "no"];

const safe = <T>(f: () => T, dflt: T): T => {
  try {
    const v = f();
    return (v ?? dflt) as T;
  } catch {
    return dflt;
  }
};

// The entities of the project at `dir`, sorted. Reference names (modules, sources,
// targets, base module refs) plus the param names seen per base module.
export function projectHints(dir: string): Hints {
  const moduleRefs = safe(() => loadModuleRefs(dir), {} as Record<string, any>);
  const modules = safe(() => loadModules(dir), {} as Record<string, any>);
  // The completion/link vocabulary is the names the chains DERIVE to — a track's id for
  // a run it feeds, a module's name for a run that starts at it (see chainsGraph.ts).
  const chains = safe(
    () => {
      const named: Record<string, true> = {};
      for (const n of Object.keys(deriveChains(loadChains(dir, {}))))
        named[n] = true;
      return named;
    },
    {} as Record<string, true>,
  );
  const tracks = safe(() => loadLanes(dir), {} as Record<string, any>);
  // Read schema-free like everything else here: a project with a broken video track
  // should still complete its audio ones.
  const videoTracks = safe(
    () => loadVideoTracks(dir),
    {} as Record<string, any>,
  );
  const clips = exportSub(dir, "clips");
  const seqs = exportSub(dir, "sequences");
  const curves = exportSub(dir, "curves");

  const sorted = (m: Record<string, any>): string[] =>
    Object.keys(m ?? {}).sort();
  const baseRefs = baseModuleRefs(moduleRefs as Record<string, any>);
  // Sinks only: an io module is one unless it declares itself a source (io: "in", a
  // live interface input). A source is not somewhere a chain can route TO, so leaving
  // it in here would offer `out: ["IN"]` as a valid target.
  const ioSinks = Object.entries(moduleRefs)
    .filter(([, b]) => (b as any)?.kind === "io" && (b as any)?.io !== "in")
    .map(([k]) => k)
    .sort();
  const ioSources = Object.entries(moduleRefs)
    .filter(([, b]) => (b as any)?.kind === "io" && (b as any)?.io === "in")
    .map(([k]) => k)
    .sort();
  // Inherited modules a chain node may name, by ref. Namespaced only: a LOCAL module is
  // already offered by its bare name, and listing it twice under two spellings is noise.
  // io is IN here: an "in" module is a step (it feeds the chain it sits in) and an "out"
  // one is what the last node names.
  const sharedRefs = Object.keys(moduleRefs)
    .filter((k) => k.startsWith("@"))
    .sort();

  // Per-base param names: what the plugin DEFINES, then the base module's own defaults, then any overrides on
  // modules that extend it or are nodes of it.
  //
  // The first source is the only complete one. The other two are learned from what somebody wrote down, so a
  // built-in nobody has authored a param on yet — the mixer, on the day it shipped — has an empty bind list and
  // no panel can be built for it. `paramMetaByBase` carries the ranges alongside, and only the plugin knows those.
  //
  // Nodes count, and they arrive as ORDINARY extenders: one use of `mixer` is a file in
  // `nodes/` that extends it. Leaving them out meant every param on every strip in a real
  // song was invisible here.
  const paramsByBase: Record<string, string[]> = {};
  const paramMetaByBase: Record<string, Record<string, ParamRange>> = {};
  for (const ref of baseRefs) {
    const base = moduleRefs[ref] as any;
    const keys = new Set<string>(Object.keys(base?.params ?? {}));
    const builtin = builtinParamsFor(base?.plugin);
    if (builtin) {
      const meta: Record<string, ParamRange> = {};
      for (const p of builtin) {
        keys.add(p.name);
        meta[p.name] = { min: p.min, max: p.max, def: p.def };
      }
      paramMetaByBase[ref] = meta;
    }
    // A node no longer needs a case of its own: it names what it uses with `extends`, like
    // any other extender. Both spellings of a local ref count — a project's own module answers to
    // the bare "<category>/<file>" and to "@project/<category>/<file>", and new files write the
    // second (see loadModuleRefs).
    for (const b of Object.values<any>(modules))
      if (b?.extends === ref || b?.extends === `@project/${ref}`)
        for (const k of Object.keys(b?.params ?? {})) keys.add(k);
    if (keys.size) paramsByBase[ref] = [...keys].sort();
  }

  // Where each entity is defined, for editor "open the file" links. Derived by the
  // folder conventions (modules/<type>/, tracks/, …) and only kept when the file
  // actually exists (external "@ns/…" modules are skipped).
  const paths: Record<string, string> = {};
  // Both spellings are tried and the one on disk wins.
  const addPath = (kind: string, name: string, stem: string) => {
    for (const ext of ["yaml", "yml"]) {
      const rel = `${stem}.${ext}`;
      if (existsSync(join(dir, rel))) {
        paths[`${kind}:${name}`] = rel;
        return;
      }
    }
  };
  // "module:" keys by the chain `use` ref, pointing at the file that IS that thing: a module
  // is `modules/<type>/<name>/module.yaml`, a node is `nodes/<name>.yaml`. An
  // node carries its own folder in `home` precisely because it is no longer under the
  // module it uses. "base:" keys by "type/name" — an `extends` ref, always a module.
  for (const [key, b] of Object.entries<any>(modules))
    if (b?.home) addPath("module", key, `${b.home}/${key}`);
    else if (b?.category)
      addPath("module", key, `modules/${b.category}/${b.file ?? key}/module`);
  for (const ref of baseRefs)
    if (!ref.startsWith("@")) {
      // The FIRST segment is the type and the rest is the name, filing included: a module may
      // sit at `modules/audio/amps/neural-amp-modeler/`, so destructuring two segments sent
      // "go to this module" at the category folder — a path with no `module.yaml` in it.
      const cut = ref.indexOf("/");
      if (cut > 0)
        addPath(
          "base",
          ref,
          `modules/${ref.slice(0, cut)}/${ref.slice(cut + 1)}/module`,
        );
    }
  for (const s of [...ioSinks, ...ioSources])
    if (!s.startsWith("@")) addPath("sink", s, `modules/io/${s}/module`);
  for (const id of Object.keys(tracks ?? {}))
    addPath("track", id, `tracks/${id}`);
  for (const id of Object.keys(clips ?? {})) addPath("clip", id, `clips/${id}`);
  for (const id of Object.keys(seqs ?? {}))
    addPath("sequence", id, `sequences/${id}`);
  for (const c of Object.keys(chains ?? {})) addPath("chain", c, "chains");

  const channels = safe(
    () =>
      loadPreferences()
        .channels.in.map((c) => c.label)
        .sort(),
    [] as string[],
  );

  // Split clips by kind so the generated overlays can keep the two references
  // apart: an audio track (and any chain source) may name only an audioClip, a
  // video track only a videoClip. Without this an audio track could reference an
  // .mp4 and it would silently compile into a Tracktion audio clip.
  const audioClips = Object.entries<any>(clips ?? {})
    .filter(([, c]) => !isVideoSource(String(c?.source ?? "")))
    .map(([id]) => id)
    .sort();
  const videoClips = Object.entries<any>(clips ?? {})
    .filter(([, c]) => isVideoSource(String(c?.source ?? "")))
    .map(([id]) => id)
    .sort();

  // What each module's file-valued params may be set to: the contents of its own `assets/`,
  // keyed by the chain `use` ref like `racks` below. Per module, because a module carries the
  // files it loads — there is no project-wide library to list any more.
  const moduleAssets: Hints["moduleAssets"] = {};
  // One walk for every module, not one per module — see assetLookup.
  const assets = assetLookup(dir);
  for (const [name, m] of Object.entries<any>(modules ?? {})) {
    if (!m?.category || !m?.file) continue;
    // Its own assets AND its ancestors' — a thin local module extending a shared amp carries
    // none of its own, and offering nothing there is what made the picker open empty.
    const files = safe(
      () => moduleAssetChoices(dir, m, moduleRefs ?? {}, assets),
      [] as string[],
    );
    if (files.length) moduleAssets[name] = files;
  }

  // Rack modules: a `type: rack` module carries a rack. Resolved first, so a module that
  // inherits its flavour, its source or half its symbols reports the whole thing.
  const racks: Hints["racks"] = {};
  for (const [name, m] of Object.entries<any>(
    resolveModuleMap(modules ?? {}, moduleRefs),
  )) {
    if (resolvedType(m) !== "rack") continue;
    const { rackType, source, symbols: mergedSymbols } = resolvedRack(m);
    const symbols = Object.entries<any>(mergedSymbols)
      .map(([symbol, e]) => ({
        symbol,
        note: Number(e?.note),
        from: e?.from != null ? Number(e.from) : undefined,
        to: e?.to != null ? Number(e.to) : undefined,
      }))
      .filter((e) => Number.isFinite(e.note));
    if (symbols.length)
      racks[name] = {
        rackType,
        source: source ? String(source) : undefined,
        symbols,
      };
  }

  return {
    baseModules: baseRefs,
    ioSinks,
    modules: [...sorted(modules), ...sharedRefs],
    tracks: sorted(tracks),
    channels,
    clips: sorted(clips),
    audioClips,
    videoClips,
    videoTracks: sorted(videoTracks),
    sequences: sorted(seqs),
    chains: sorted(chains),
    curves: sorted(curves),
    moduleAssets,
    paramsByBase,
    paramMetaByBase,
    racks,
    keywords: YAML_KEYWORDS,
    pluginNames: {},
    paths,
    media: safe(() => scanMedia(dir), {} as Record<string, string[]>),
  };
}
