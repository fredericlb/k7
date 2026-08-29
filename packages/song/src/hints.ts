// hints.ts — a project's entities, structured for schema-aware autocompletion.
//
// Feeds the editor's completion source, its reference links, and the note editors' rack
// vocabulary. Every gather is wrapped so a broken project degrades to whatever loaded
// rather than throwing — completion on a half-written file is exactly when you need it.

import { type Dirent, existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import {
  builtinParamsFor,
  type ParamRange,
} from "@studio/song-schema/builtinParams";
import {
  CUE_NODE,
  completionOrder,
  isEngineRef,
  MIX_NODE,
  moduleStatusOf,
  OUT_NODE,
  RENDER_NODE,
  VIDEO_OUT_NODE,
} from "@studio/song-schema/moduleTypes";
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
  withModuleStamp,
} from "./loader";
import { assetLookup, moduleAssetChoices } from "./moduleAssetChoices";
import { resolvedRack, resolvedType, resolveModuleMap } from "./moduleResolve";
import { loadPreferences } from "./preferences";

export interface Hints {
  baseModules: string[]; // plugin module refs a module can `extends` ("type/name", "@ns/type/name")
  ioSinks: string[]; // io module names a chain can route TO ("OUT")
  // The chain `use` vocabulary: bare names, "<name>:<node>", inherited refs — see docs/hints.md.
  modules: string[];
  tracks: string[];
  // Input-channel labels from the MACHINE's preferences, not the project — see docs/hints.md.
  channels: string[];
  clips: string[]; // every clip id (audio + video) — for the editor's link map
  audioClips: string[]; // clips whose source is NOT a video file
  videoClips: string[]; // clips whose source IS a video file
  // Video track ids an audio track's `video_source` may name — see docs/hints.md.
  videoTracks: string[];
  sequences: string[];
  chains: string[];
  curves: string[]; // automation curve ids (curves/<id>.yaml) — for pinning a module's automations
  // What each module's file-valued params may be set to, keyed by the chain `use` ref — see docs/hints.md.
  moduleAssets: Record<string, string[]>;
  paramsByBase: Record<string, string[]>; // base ref -> known param names (open — new ones still allowed)
  // …and what those params SPAN, for the built-in plugins we define — see docs/hints.md.
  paramMetaByBase: Record<string, Record<string, ParamRange>>;
  // Rack modules -> their effective (base+module) rack, for the note editors — see docs/hints.md.
  racks: Record<
    string,
    {
      rackType: "samples" | "slice";
      source?: string; // slice: the clip id every symbol slices from
      symbols: { symbol: string; note: number; from?: number; to?: number }[];
    }
  >;
  keywords: string[]; // words YAML gives meaning to
  // Scanned plugin names by format, filled by the file service from ~/.studio/exts.json.
  pluginNames: Record<string, string[]>;
  // "kind:name" -> the project-relative file that defines the entity — see docs/hints.md.
  paths: Record<string, string>;
  // Audio filenames keyed by their project-relative FOLDER ("" = the root) — see docs/hints.md.
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

// Every audio file in the project, grouped by its project-relative folder — see docs/hints.md.
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

// The words YAML gives meaning to, offered so they are completed rather than mistyped — see docs/hints.md.
const YAML_KEYWORDS = ["true", "false", "null", "on", "off", "yes", "no"];

const safe = <T>(f: () => T, dflt: T): T => {
  try {
    const v = f();
    return (v ?? dflt) as T;
  } catch {
    return dflt;
  }
};

// The entities of the project at `dir`, sorted; one stamp walk covers the two module reads (moduleCache.ts).
export function projectHints(dir: string): Hints {
  return withModuleStamp(dir, () => projectHintsIn(dir));
}

function projectHintsIn(dir: string): Hints {
  const moduleRefs = safe(() => loadModuleRefs(dir), {} as Record<string, any>);
  const modules = safe(() => loadModules(dir), {} as Record<string, any>);
  // The vocabulary is the names the chains DERIVE to, not the ones written down (chainsGraph.ts).
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
  // Read schema-free: a project with a broken video track should still complete its audio ones.
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
  // Sinks only, the built-in outputs first, the picture's pair only on a project that has one — docs/hints.md.
  const ioSinks = [
    MIX_NODE,
    OUT_NODE,
    // Offered everywhere, like the two above: monitoring a lane off the mix is not a desk's privilege.
    CUE_NODE,
    ...(Object.keys(videoTracks ?? {}).length
      ? [RENDER_NODE, VIDEO_OUT_NODE]
      : []),
    ...Object.entries(moduleRefs)
      .filter(([, b]) => (b as any)?.kind === "io" && (b as any)?.io !== "in")
      .map(([k]) => k)
      .sort(),
  ];
  const ioSources = Object.entries(moduleRefs)
    .filter(([, b]) => (b as any)?.kind === "io" && (b as any)?.io === "in")
    .map(([k]) => k)
    .sort();
  // Inherited modules a chain node may name: namespaced only, io in, `@engine` out — see docs/hints.md.
  const sharedRefs = Object.keys(moduleRefs)
    .filter((k) => k.startsWith("@") && !isEngineRef(k))
    .sort();

  // Per-base params: what the plugin defines, the base's defaults, then its extenders' — see docs/hints.md.
  const paramsByBase: Record<string, string[]> = {};
  const paramMetaByBase: Record<string, Record<string, ParamRange>> = {};
  // What each base ref's EXTENDERS have written on it, indexed once in one pass — see docs/hints.md.
  const PROJECT_NS = "@project/";
  const byExtends = new Map<string, Set<string>>();
  for (const b of Object.values<any>(modules)) {
    const ext = b?.extends;
    if (typeof ext !== "string" || !ext) continue;
    const ref = ext.startsWith(PROJECT_NS) ? ext.slice(PROJECT_NS.length) : ext;
    let keys = byExtends.get(ref);
    if (!keys) byExtends.set(ref, (keys = new Set<string>()));
    for (const k of Object.keys(b?.params ?? {})) keys.add(k);
  }
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
    // The ref is normalised on the way IN too, or the `@project/` spelling reads an empty bucket.
    const bucket = ref.startsWith(PROJECT_NS)
      ? ref.slice(PROJECT_NS.length)
      : ref;
    for (const k of byExtends.get(bucket) ?? []) keys.add(k);
    if (keys.size) paramsByBase[ref] = [...keys].sort();
  }

  // Where each entity is defined, for editor "open the file" links — see docs/hints.md.
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
  // "module:" keys by the chain `use` ref and "base:" by "type/name" — see docs/hints.md.
  for (const [key, b] of Object.entries<any>(modules))
    if (b?.home) addPath("module", key, `${b.home}/${key}`);
    else if (b?.category)
      addPath("module", key, `modules/${b.category}/${b.file ?? key}/module`);
  for (const ref of baseRefs)
    if (!ref.startsWith("@")) {
      // The FIRST segment is the type and the rest is the name, filing included — see docs/hints.md.
      const cut = ref.indexOf("/");
      if (cut > 0) {
        addPath(
          "base",
          ref,
          `modules/${ref.slice(0, cut)}/${ref.slice(cut + 1)}/module`,
        );
        // The `@project/` spelling is the SAME module, and without this alias a ctrl-click goes blind.
        const rel = paths[`base:${ref}`];
        if (rel) paths[`base:@project/${ref}`] = rel;
      }
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

  // Split by kind so the overlays keep an audio and a video reference apart — see docs/hints.md.
  const audioClips = Object.entries<any>(clips ?? {})
    .filter(([, c]) => !isVideoSource(String(c?.source ?? "")))
    .map(([id]) => id)
    .sort();
  const videoClips = Object.entries<any>(clips ?? {})
    .filter(([, c]) => isVideoSource(String(c?.source ?? "")))
    .map(([id]) => id)
    .sort();

  // What each module's file-valued params may be set to, keyed by the chain `use` ref — see docs/hints.md.
  const moduleAssets: Hints["moduleAssets"] = {};
  // One walk for every module, not one per module — see assetLookup.
  const assets = assetLookup(dir);
  for (const [name, m] of Object.entries<any>(modules ?? {})) {
    if (!m?.category || !m?.file) continue;
    // Its own assets AND its ancestors', or a thin module extending a shared amp opens the picker empty.
    const files = safe(
      () => moduleAssetChoices(dir, m, moduleRefs ?? {}, assets),
      [] as string[],
    );
    if (files.length) moduleAssets[name] = files;
  }

  // Resolved first, so a module inheriting its flavour, its source or half its symbols reports the whole rack.
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
    // Hidden ones dropped and favourites first, off the AUTHORED module's `status:` — see docs/hints.md.
    modules: completionOrder([...sorted(modules), ...sharedRefs], (name) =>
      moduleStatusOf(modules[name] ?? moduleRefs[name]),
    ),
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
