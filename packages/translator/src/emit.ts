// emit.ts — write a Song (from any mapper) out as a node/lane/chain project: a
// project.yaml + graph.yaml, one self-contained module folder per plugin, and
// nodes/clips/sequences. No schema file ships with it — a project is validated in
// process against the loader's own schemas. Layout + mapping: docs/import.md.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { scannedPlugins } from "@studio/song/engineCatalogue";
import { SHARED_STRIP } from "@studio/song/scaffoldLive";
import { SHARED_MODULES_PATH } from "@studio/song/sharedFolders";
import { wsWrite } from "@studio/song/yaml/workspaceFile";
import { materialWindow } from "@studio/song-edit/materialWindow";
import {
  MIX_NODE,
  NOT_SUPPORTED_REF,
  NOT_SUPPORTED_TYPE,
  OUT_NODE,
} from "@studio/song-schema/moduleTypes";
import { beatsToDuration, beatsToPosition } from "@studio/song-schema/timecode";
import { quoteTimecodes } from "@studio/song-schema/yaml/moduleFile";
import { isSeq, parseDocument } from "yaml";
import type { ClipOut, PluginOut, Song, TrackOut } from "./model.js";

/** What a MIDI lane plays when its own instrument could not cross over — a drum rack, and the rest. */
const STAND_IN_KIT = "@k7-core/instruments/k7-rack";
const STAND_IN_SYNTH = "@k7-core/instruments/synth/surge-xt";

// --- YAML emitters -----------------------------------------------------------

// The SHAPE decisions, matching what k7 itself writes — see docs/import.md.

/** A YAML document with `flow` set on `flowPaths`' items and on `selfPaths`' own node. */
function yamlDoc(
  value: unknown,
  flowPaths: (string | number)[][] = [],
  selfPaths: (string | number)[][] = [],
): ReturnType<typeof parseDocument> {
  const doc = parseDocument("{}", { version: "1.2" });
  doc.contents = doc.createNode(value) as typeof doc.contents;
  for (const path of flowPaths) {
    const node = doc.getIn(path);
    if (isSeq(node)) for (const item of node.items) flowOf(item);
    else flowOf(node);
  }
  for (const path of selfPaths) flowOf(doc.getIn(path));
  quoteTimecodes(doc);
  return doc;
}

const flowOf = (node: unknown): void => {
  if (node && typeof node === "object")
    (node as { flow?: boolean }).flow = true;
};

/** The file's text: an optional `#` comment block, then the document. */
function yamlText(
  value: unknown,
  flowPaths: (string | number)[][] = [],
  note?: string,
  selfPaths: (string | number)[][] = [],
): string {
  const head = note
    ? `${note
        .split("\n")
        .map((l) => `# ${l}`)
        .join("\n")}\n`
    : "";
  return head + yamlDoc(value, flowPaths, selfPaths).toString({ lineWidth: 0 });
}

/** A param map, or undefined when there is nothing to write. */
const paramsOf = (
  p?: Record<string, number>,
): Record<string, number> | undefined =>
  p && Object.keys(p).length ? p : undefined;

// --- filesystem + slugs ------------------------------------------------------

function writeFile(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  // Through the workspace door, so an imported project is written in the format new files take (song's k7xFiles.md).
  wsWrite(path, content);
}

// Real name -> a snake_case, filesystem-safe base. Every file created on import is named this way.
function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "node";
}
function uniquify(base: string, used: Set<string>): string {
  let s = base;
  let n = 2;
  while (used.has(s.toLowerCase())) s = `${base}_${n++}`; // stay snake_case on collision
  used.add(s.toLowerCase());
  return s;
}

// Plugin names in the local cache, for telling whether an imported plugin exists here; empty ⇒ skip the check.
function loadCachedPluginNames(file?: string): Set<string> {
  // Through scannedPlugins, so this reads the SAME file the engine writes and honours $STUDIO_HOME
  // (docs/import.md).
  const names = new Set<string>();
  for (const p of file ? scannedPlugins(file) : scannedPlugins())
    if (p.name) names.add(p.name.toLowerCase());
  return names;
}

// Plugin chain order: instruments (and note FX) before audio FX; stable within.
const roleRank = (r?: string): number =>
  r === "instrument" ? 0 : r === "noteFX" ? 1 : 2;
const orderPlugins = (ps: PluginOut[]): PluginOut[] =>
  ps
    .map((p, i) => [p, i] as const)
    .sort((a, b) => roleRank(a[0].role) - roleRank(b[0].role) || a[1] - b[1])
    .map((x) => x[0]);

// --- chain graph -------------------------------------------------------------

interface Step {
  module: string; // a module node name (params live on the module, not here)
  enabled?: boolean; // undefined => on
}
interface OutDef {
  to: string;
  gain?: number; // undefined or 1 => the whole signal; <1 => a weighted send
}
interface ChainDef {
  from?: string;
  use: Step[]; // ordered module nodes (source -> use[0] -> use[1] -> … -> out)
  enabled?: boolean; // undefined => on
  out: OutDef[];
}
// A self-contained module: one per PLUGIN, one insert per use — see docs/import.md.
interface ModuleDef {
  name: string;
  folder: string;
  pluginType: string;
  pluginName: string;
  inserts: InsertDef[];
}

// One use of a plugin: its settings and the node file they land in; `node` is "" once collapsed.
interface InsertDef {
  node: string;
  params?: Record<string, number>;
  preset?: string; // asset key for the opaque .vstpreset blob
}

// Keep the first mention of each destination (a track's dry output + its sends).
function dedupeOuts(outs: OutDef[]): OutDef[] {
  const seen = new Set<string>();
  return outs.filter((o) => (seen.has(o.to) ? false : (seen.add(o.to), true)));
}

/** The chains as SEGMENTS — who feeds whom, which is how the imported sends survive; docs/import.md. */
function chainSegments(chains: Record<string, ChainDef>): {
  tracks: Record<string, string[]>;
  modules: Record<string, string[]>;
  bypassed: string[];
} {
  const tracks: Record<string, string[]> = {};
  const modules: Record<string, string[]> = {};
  const bypassed: string[] = [];

  const entryOf = (name: string, seen = new Set<string>()): string | null => {
    const d = chains[name];
    if (!d || seen.has(name)) return name; // a sink (OUT), or a module — either way, itself
    seen.add(name);
    if (d.use.length) return d.use[0].module;
    const next = d.out[0]?.to;
    return next ? entryOf(next, seen) : null;
  };
  const link = (
    into: Record<string, string[]>,
    node: string,
    tos: (string | null)[],
  ) => {
    into[node] ??= [];
    const list = into[node];
    for (const to of tos) if (to && !list.includes(to)) list.push(to);
  };

  for (const [name, d] of Object.entries(chains)) {
    const path = d.use.map((s) => s.module);
    const ends = d.out.map((o) => entryOf(o.to));
    if (d.from) link(tracks, d.from, path.length ? [path[0]] : ends);
    else if (path.length) link(modules, path[0], []); // a bus's first node exists before anything feeds it
    for (let i = 0; i < path.length; i++)
      link(modules, path[i], i + 1 < path.length ? [path[i + 1]] : ends);
    for (const s of d.use)
      if (s.enabled === false || d.enabled === false) bypassed.push(s.module);
  }
  return { tracks, modules, bypassed };
}

// --- placements + track files ------------------------------------------------

// Every timing field is a #Timecode STRING, never a bare number: `4` parses as BARS and lands the clip at beat 12.
function placementOf(
  p: {
    ref: string;
    start: number;
    loops: number;
    fadeIn?: number;
    fadeOut?: number;
    disabled?: boolean;
  },
  num: number,
  den: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ref: p.ref,
    start: beatsToPosition(p.start, num, den),
  };
  // The clip's extent is NOT written here: it belongs to the material — see docs/import.md.
  if (p.loops > 1) out.loop = p.loops;
  if (p.disabled) out.disabled = true;
  const opt = (k: string, v?: number) => {
    if (v) out[k] = beatsToDuration(v, num, den);
  }; // drop zeros
  opt("fadeIn", p.fadeIn);
  opt("fadeOut", p.fadeOut);
  return out;
}

// The window a clip/sequence declares, as two quoted POSITION timecodes; a window at the start says so by omission.
function windowFields(
  w: { from: number; to: number },
  num: number,
  den: number,
): Record<string, string> {
  return {
    ...(w.from > 0 ? { from: beatsToPosition(w.from, num, den) } : {}),
    ...(w.to > w.from ? { to: beatsToPosition(w.to, num, den) } : {}),
  };
}

function trackText(t: TrackOut, placements: Record<string, unknown>[]): string {
  // No `name` field, and the mute is the module's bypass rather than anything here — see docs/import.md.
  const value: Record<string, unknown> = {};
  if (t.color) value.color = t.color;
  value.extends = "@meta/track";
  // The lane file's own key is `events:`, not `clips:`: these are placements of the material.
  value.events = placements;
  return yamlText(value, [["events"]]);
}

// --- entry -------------------------------------------------------------------

export interface EmitStats {
  trackFiles: number;
  clipFiles: number;
  sequenceFiles: number;
  chainFiles: number;
  moduleNodes: number; // module.yaml files written under modules/<type>/
  // nodes/<name>.yaml files — one per use of a plugin used more than once (see ModuleDef).
  nodeFiles: number;
  modulePresetFiles: number; // .vstpreset files, beside the node or module whose state they are
  missingAudio: string[];
  missingPlugins: string[]; // referenced but not in the k7 cache -> stubbed
  standIns: number; // MIDI lanes given a library instrument in place of one that did not cross over
  // Tracks given both audio and MIDI: they import as "sequences", and their audio won't load until split by hand.
}

export function emitFolder(
  outDir: string,
  song: Song,
  assets: Record<string, Uint8Array>,
  // The plugin scan to check names against. Defaults to this machine's; a test names its own.
  extsFile?: string,
): EmitStats {
  mkdirSync(outDir, { recursive: true });
  // OUT needs no module of its own — a built-in sink name, docs/moduleTypes.md ("The five built-in outputs").

  // Plugin state rides as a .vstpreset beside whichever file owns it — see docs/import.md.

  // Unique name-slug per track (used as track id, chain entry name, send target).
  const usedTrackSlugs = new Set<string>();
  const slugOf = new Map<string, string>();
  for (const t of song.tracks)
    slugOf.set(t.id, uniquify(slugify(t.name), usedTrackSlugs));

  // A flat node shares ONE namespace with the lanes and the modules — packages/song/docs/nodes.md.
  const usedNodeNames = new Set<string>(usedTrackSlugs);
  let standIns = 0;

  // A plugin's type folder from its role, writing `transformers` rather than the legacy `midi`.
  const typeFolderOf = (role?: string): string =>
    role === "instrument"
      ? "instruments"
      : role === "noteFX"
        ? "transformers"
        : "audio";

  // Modules keyed by the PLUGIN and not its settings, so nodes are only paid for where they differ —
  // seeded with what the WORKSPACE's `_modules` already holds, since that is where a module now
  // lands: an import must not silently reuse or shadow another song's module of the same name.
  const usedModuleNames = new Set<string>();
  const workspaceModulesDir = resolve(outDir, SHARED_MODULES_PATH);
  for (const type of ["audio", "instruments", "transformers"]) {
    try {
      for (const name of readdirSync(join(workspaceModulesDir, type)))
        usedModuleNames.add(name.toLowerCase());
    } catch {
      /* no such type folder yet — nothing to avoid */
    }
  }
  const moduleOf = new Map<string, ModuleDef>();
  const modules: ModuleDef[] = [];
  // `owner` is the slug of the chain this insert sits on — the node's name.
  const moduleRefFor = (p: PluginOut, owner: string): string => {
    const folder = typeFolderOf(p.role);
    // Text params capture state when complete or when there is no preset; else keep the .vstpreset and skip partials.
    const hasParams = !!p.params && Object.keys(p.params).length > 0;
    const useParams = hasParams && (p.paramsComplete || !p.path);
    const params = useParams ? p.params : undefined;
    const preset = useParams ? undefined : p.path || undefined;
    const key = `${folder}/${p.type}/${p.name}`;
    let mod = moduleOf.get(key);
    if (!mod) {
      mod = {
        name: uniquify(slugify(p.name || p.type), usedModuleNames),
        folder,
        pluginType: p.type,
        pluginName: p.name,
        inserts: [],
      };
      moduleOf.set(key, mod);
      modules.push(mod);
    }
    // A sole use folds back into module.yaml, so the module's own name is taken as far as a node is concerned.
    usedNodeNames.add(mod.name.toLowerCase());
    // Each insert gets its OWN node even when identically set — they are separate slots; docs/import.md.
    const node = uniquify(`${mod.name}_${owner}`, usedNodeNames);
    mod.inserts.push({ node, params, preset });
    return node;
  };

  // Master → OUT (or a master chain if it carries plugins).
  const master = song.tracks.find((t) => t.role === "master");
  const masterPlugins = orderPlugins(master?.plugins ?? []);
  /**
   * Where a lane ends: the mixer's SUM, like every k7 project — a level belongs to what goes out,
   * and the run between `MIX` and `OUT` is the master chain (packages/song/docs/masterChain.md).
   * Not an audible difference — every track feeds the master bus whatever it names — but the
   * notation the rest of the app reads: a strip is spliced into the arrow into `MIX`.
   */
  const masterSink = MIX_NODE;
  /** The master chain's own name, when the master track carries plugins — what `MIX` runs into. */
  const masterChain =
    master && masterPlugins.length ? slugOf.get(master.id) : undefined;

  const chains: Record<string, ChainDef> = {};
  const busChains = new Set<string>(); // return-bus chains (no `from`, fed by sends)
  const usedChainNames = new Set<string>(["out"]); // avoid a chain literally named OUT
  const usedClipIds = new Set<string>();
  let clipFiles = 0;
  let sequenceFiles = 0;
  const missingAudio: string[] = [];

  // One file per distinct RECORDING, not per clip. A foreign project cuts several clips out of one
  // take — twelve bass ones, five vocal ones — and some export one file per clip regardless, byte
  // for byte identical. Either way a copy per clip cost a real import 345 MB for 91 MB of audio,
  // and a waveform decode each. Keyed by CONTENT, since that is the half both cases share.
  // See docs/import.md.
  const audioRel = new Map<string, string>();
  const takenAudio = new Set<string>();
  /** Where these bytes land, named after the file the archive called them and never after a clip. */
  const audioFor = (source: string, bytes: Uint8Array): string => {
    const key = createHash("sha1").update(bytes).digest("hex");
    const held = audioRel.get(key);
    if (held) return held;
    const ext = extname(source) || ".wav";
    const stem =
      basename(source, extname(source)).replace(/[^A-Za-z0-9_.-]+/g, "_") ||
      "audio";
    let name = `${stem}${ext}`;
    for (let n = 2; takenAudio.has(name.toLowerCase()); n++)
      name = `${stem}-${n}${ext}`;
    takenAudio.add(name.toLowerCase());
    const rel = `clips/${name}`;
    audioRel.set(key, rel);
    return rel;
  };

  /**
   * A lane's strip, last in its run: one use of the LIBRARY's mixer, which is what every mixer node
   * in every project names (`SHARED_STRIP`). A node and not a project module — a copy of a library
   * module compiles to the same audio and draws a card with no controls on it, the panel living on
   * the library's own `ui.yaml` (`packages/song/docs/liveProject.md`). Nothing here changes the
   * module, so nothing here owns one.
   */
  const addTrackMixer = (entry: string): string => {
    let name = `mix-${entry}`;
    for (
      let n = 2;
      usedChainNames.has(name.toLowerCase()) ||
      usedNodeNames.has(name.toLowerCase());
      n++
    )
      name = `mix-${entry}-${n}`;
    usedChainNames.add(name.toLowerCase());
    usedNodeNames.add(name.toLowerCase());
    writeFile(
      join(outDir, `nodes/${name}.yaml`),
      `# ${entry}'s strip: volume, pan and three bands, and the one place its level lives.\n` +
        `#\n` +
        `# Written by the import, because a lane without one plays at unity with nowhere to put a\n` +
        `# level — see packages/song/docs/trackMixer.md.\n` +
        `extends: ${JSON.stringify(SHARED_STRIP)}\n`,
    );
    // Not counted in `nodeFiles`: that stat is one node per plugin USE, and a strip is neither the
    // source project's plugin nor its use — it is what every lane gets whatever the source said.
    return name;
  };

  /**
   * A MIDI lane whose instrument did not cross over — a source DAW's own synth or drum rack — gets a
   * library one in its place: a lane's notes into its strip is wiring the loader refuses, and a song
   * that will not open is worse than one whose sound is a stand-in. A drum rack gets the SFZ kit,
   * whose pads sit on General MIDI notes as most drum racks' do; anything else the synth.
   */
  const addStandIn = (entry: string, drums: boolean): string => {
    let name = `${entry}-instrument`;
    for (
      let n = 2;
      usedChainNames.has(name.toLowerCase()) ||
      usedNodeNames.has(name.toLowerCase());
      n++
    )
      name = `${entry}-instrument-${n}`;
    usedNodeNames.add(name.toLowerCase());
    writeFile(
      join(outDir, `nodes/${name}.yaml`),
      `# ${entry}'s instrument, a STAND-IN: the source project's could not be carried over, so the
` +
        `# import put a library one here — replace it with the instrument this part was written for.
` +
        `extends: ${JSON.stringify(drums ? STAND_IN_KIT : STAND_IN_SYNTH)}
`,
    );
    standIns++;
    return name;
  };

  // One chain per source: its ordered plugins become `use` steps, each naming a module node, routed to `terminal`.
  const addChain = (
    entry: string,
    fromTrack: string | undefined,
    plugins: PluginOut[],
    terminal: OutDef[],
    standIn?: { drums: boolean },
  ) => {
    usedChainNames.add(entry.toLowerCase());
    const use = orderPlugins(plugins).map((p) => ({
      // The chain names a NODE; collapseSoleInserts rewrites it to the bare module when the plugin is used once.
      module: moduleRefFor(p, entry),
      enabled: p.enabled ? undefined : false,
    }));
    // The stand-in leads, where the instrument the source had would have stood.
    if (standIn)
      use.unshift({
        module: addStandIn(entry, standIn.drums),
        enabled: undefined,
      });
    // A LANE gets its strip, last; a return bus and the master chain are not lanes and get none.
    if (fromTrack)
      use.push({ module: addTrackMixer(entry), enabled: undefined });
    chains[entry] = { from: fromTrack, use, out: terminal };
  };

  // Emit a source track's arrangement + raw material, return the placement values.
  const emitArrangement = (
    t: TrackOut,
    slug: string,
  ): Record<string, unknown>[] => {
    const placements: Record<string, unknown>[] = [];
    (t.clips ?? []).forEach((c: ClipOut, i) => {
      const cid = uniquify(`${slug}_${i}`, usedClipIds);
      if (c.type === "midi") {
        // Notes go inline as compact {t,d,k,v}, one per line — full fidelity, no quantised round-trip; `v` omitted at 1.
        const notes = (c.notes ?? []).map((n) => ({
          t: n.time,
          d: n.duration,
          k: n.key,
          ...(n.vel !== undefined && n.vel !== 1 ? { v: n.vel } : {}),
        }));
        const w = materialWindow(c);
        writeFile(
          join(outDir, `sequences/${cid}.yaml`),
          yamlText({ ...windowFields(w, tsNum(song), tsDen(song)), notes }, [
            ["notes"],
          ]),
        );
        placements.push(
          placementOf(
            {
              ref: cid,
              start: c.start,
              loops: w.loops,
              disabled: c.disabled,
            },
            tsNum(song),
            tsDen(song),
          ),
        );
        sequenceFiles++;
      } else {
        // The clip's own file is its YAML; the audio is shared, so the bytes land once per recording.
        const bytes = c.source ? assets[c.source] : undefined;
        const wavRel =
          bytes && c.source
            ? audioFor(c.source, bytes)
            : `clips/${cid}${extname(c.source ?? "") || ".wav"}`;
        if (bytes && !existsSync(join(outDir, wavRel)))
          writeFile(join(outDir, wavRel), bytes);
        else if (!bytes) missingAudio.push(cid);
        // A warped clip carries its stretch settings, so the engine time-stretches it as the source DAW did.
        const w = materialWindow(c);
        writeFile(
          join(outDir, `clips/${cid}.yaml`),
          yamlText(
            {
              source: wavRel,
              ...windowFields(w, tsNum(song), tsDen(song)),
              ...(c.warp
                ? {
                    warp: {
                      algorithm: c.warp.algorithm ?? "elastique",
                      markers: c.warp.markers.map(([b, sec]) => [b, sec]),
                    },
                  }
                : {}),
            },
            // One marker pair per line, like every other list of small tuples here.
            c.warp ? [["warp", "markers"]] : [],
          ),
        );
        placements.push(
          placementOf(
            {
              ref: cid,
              start: c.start,
              loops: w.loops,
              fadeIn: c.fadeIn,
              fadeOut: c.fadeOut,
              disabled: c.disabled,
            },
            tsNum(song),
            tsDen(song),
          ),
        );
        clipFiles++;
      }
    });
    return placements;
  };

  let trackFiles = 0;
  for (const t of song.tracks) {
    if (t.role === "master") continue; // handled below
    const slug = slugOf.get(t.id)!;
    const isBus = t.role === "effect"; // a return bus: no clips, fed by sends

    // Dry output goes to the master at full gain; each enabled send fans out to its bus at the send's level.
    const sendTargets: OutDef[] = (t.sends ?? [])
      .filter((s) => s.enabled)
      .map((s): OutDef => ({ to: slugOf.get(s.to) ?? s.to, gain: s.level }))
      .filter((o) => !!o.to);
    const terminal = dedupeOuts([{ to: masterSink }, ...sendTargets]);

    // Audio and no MIDI means a bounced track: drop its instrument/note FX (the frozen remains), keep the audio FX.
    const clips = t.clips ?? [];
    const audioSource =
      !isBus &&
      clips.some((c) => c.type !== "midi") &&
      !clips.some((c) => c.type === "midi");
    const plugins = audioSource
      ? (t.plugins ?? []).filter(
          (p) => p.role !== "instrument" && p.role !== "noteFX",
        )
      : (t.plugins ?? []);

    // Notes and nothing to play them: the instrument stayed behind in the source DAW.
    const needsInstrument =
      !isBus &&
      clips.some((c) => c.type === "midi") &&
      !plugins.some((p) => p.role === "instrument");
    addChain(
      slug,
      isBus ? undefined : slug,
      plugins,
      terminal,
      needsInstrument ? { drums: !!t.drums } : undefined,
    );
    if (isBus) busChains.add(slug);

    if (!isBus) {
      writeFile(
        join(outDir, `nodes/${slug}.yaml`),
        trackText(t, emitArrangement(t, slug)),
      );
      trackFiles++;
    }
  }

  // Master chain (only if it has plugins; else `MIX` and `OUT` are a single wire).
  if (master && masterPlugins.length)
    addChain(slugOf.get(master.id)!, undefined, masterPlugins, [
      { to: OUT_NODE },
    ]);

  // Drop dead return buses — a bus nothing routes into is unfed. Cascades, since one may feed another now-dead bus.
  for (let changed = true; changed; ) {
    changed = false;
    const routedInto = new Set<string>();
    for (const d of Object.values(chains))
      for (const o of d.out) routedInto.add(o.to);
    for (const name of [...busChains])
      if (!routedInto.has(name)) {
        delete chains[name];
        busChains.delete(name);
        changed = true;
      }
  }

  // Which module refs a SURVIVING chain names: an orphaned insert must not count towards "used more than once".
  const liveRefs = new Set<string>();
  for (const d of Object.values(chains))
    for (const step of d.use) liveRefs.add(step.module);
  for (const mod of modules)
    mod.inserts = mod.inserts.filter((i) => liveRefs.has(i.node));

  // A plugin used in exactly ONE place needs no node: fold it into module.yaml — see docs/import.md.
  const collapseSoleInserts = () => {
    for (const mod of modules) {
      if (mod.inserts.length !== 1) continue;
      // …unless its bare name is a CHAIN's. `graph.yaml` has one name space, and a lane wins a bare
      // name in it, so a step collapsed onto one reads as the chain naming ITSELF — the instrument
      // then vanishes and the lane's midi lands on the next module's audio input. The case is not
      // exotic: a track called after the device on it, which is what a DAW writes by default.
      if (chains[mod.name]) continue;
      const [only] = mod.inserts;
      const from = only.node;
      only.node = ""; // "" == the state lives in module.yaml
      for (const d of Object.values(chains))
        for (const step of d.use)
          if (step.module === from) step.module = mod.name;
    }
  };
  collapseSoleInserts();

  // graph.yaml — SEGMENTS, and the send LEVELS are still lost by it; see docs/import.md.
  const {
    tracks: chainTracks,
    modules: chainModules,
    bypassed,
  } = chainSegments(chains);
  const weighted = Object.values(chains).reduce(
    (n, d) => n + d.out.filter((o) => o.gain != null && o.gain !== 1).length,
    0,
  );
  // What the sum runs into: the master run's FIRST module — a chain's name is never a node — or the
  // output itself, `MIX` and `OUT` being a single wire when nothing treats the whole (docs/masterChain.md).
  // Read after the collapse, which may have renamed that step onto its module.
  const mixSink =
    (masterChain ? chains[masterChain]?.use[0]?.module : undefined) ?? OUT_NODE;
  // ONE map, lanes first, so the file reads the way the signal flows — packages/song/docs/trackModules.md.
  // `MIX` last: the sum is where every lane arrived, and what it runs into closes the file.
  const chainNodes = { ...chainTracks, ...chainModules, [MIX_NODE]: [mixSink] };
  const seg: Record<string, unknown> = {};
  if (Object.keys(chainNodes).length) seg.modules = chainNodes;
  // A lane the import found MUTED is bypassed, which is where a lane's mute lives.
  const muted = song.tracks
    .filter(
      (t) =>
        t.mute &&
        slugOf.has(t.id) &&
        !busChains.has(slugOf.get(t.id) as string),
    )
    .map((t) => slugOf.get(t.id) as string);
  const allBypassed = [...bypassed, ...muted];
  if (allBypassed.length) seg.bypassed = allBypassed;
  writeFile(
    join(outDir, "graph.yaml"),
    yamlText(
      seg,
      [],
      weighted
        ? `NOTE: ${weighted} weighted send(s) arrived at full level — a destination says\n` +
            `WHERE the signal goes, not how much of it. Trim them on the bus's own module.`
        : undefined,
      // One node per line, its destinations a flow sequence — the canonical form.
      [...Object.keys(chainNodes).map((k) => ["modules", k]), ["bypassed"]],
    ),
  );

  // Which modules survive: one whose every insert is orphaned has nothing left to write.
  const liveModules = modules.filter((b) => b.inserts.length > 0);

  // Modules -> module.yaml, plus one flat nodes/<node>.yaml per insert past the first — see docs/import.md.
  const cachedNames = loadCachedPluginNames(extsFile);
  const verify = cachedNames.size > 0; // nothing to check against without a scan
  const missingPlugins = new Set<string>();
  let modulePresetFiles = 0;
  let moduleNodes = 0;
  let nodeFiles = 0;
  for (const b of liveModules) {
    // A module now lives at `@workspace`, beside the project rather than inside it.
    const dir = join(workspaceModulesDir, b.folder, b.name);
    const known = !verify || cachedNames.has(b.pluginName.toLowerCase());
    // A sole insert's state belongs in module.yaml (node === "").
    const sole = b.inserts.length === 1 && b.inserts[0].node === "";

    // A plugin this machine cannot load gets NO module of its own: every use becomes a node on the
    // built-in placeholder, which is the whole of what such a module would say (docs/import.md).
    if (!known) {
      missingPlugins.add(b.pluginName);
      for (const ins of b.inserts) {
        const params = paramsOf(ins.params);
        writeFile(
          join(outDir, `nodes/${ins.node || b.name}.yaml`),
          yamlText(
            {
              extends: NOT_SUPPORTED_REF,
              // The plugin's real name, restated with the marker since a node's `plugin:` replaces its base's whole.
              plugin: { type: NOT_SUPPORTED_TYPE, name: b.pluginName },
              ...(params ? { params } : {}),
            },
            [],
            `MISSING PLUGIN: "${b.pluginName}" (${b.pluginType}) is not in the k7 plugin cache.\n` +
              `This node stands where it was: routing only, and bypassed. Install and scan it\n` +
              `('k7 engine scan') and re-import, or point this node's \`extends\` at a real module.\n` +
              `The params below are the ones the export carried, kept so nothing is lost.`,
          ),
        );
        nodeFiles++;
      }
      continue;
    }

    const value: Record<string, unknown> = {
      plugin: { type: b.pluginType, name: b.pluginName },
    };
    if (sole) {
      const params = paramsOf(b.inserts[0].params);
      if (params) value.params = params;
    }
    const note = sole
      ? undefined
      : `${b.pluginName} — used ${b.inserts.length} times in this song, so each use is a\n` +
        `NODE in nodes/ that extends this module. The plugin is declared once here;\n` +
        `each node carries only its own settings.`;
    writeFile(join(dir, "module.yaml"), yamlText(value, [], note));
    moduleNodes++;

    for (const ins of b.inserts) {
      if (ins.node) {
        const params = paramsOf(ins.params);
        // A node is a flat file naming what it extends — packages/song/docs/nodes.md.
        writeFile(
          join(outDir, `nodes/${ins.node}.yaml`),
          yamlText(
            {
              extends: `@workspace/${b.folder}/${b.name}`,
              ...(params ? { params } : {}),
            },
            [],
            `${ins.node} — inherits ${b.name} (the plugin); only what this use sets differs.`,
          ),
        );
        nodeFiles++;
      }
      if (ins.preset && assets[ins.preset]) {
        // Beside the file whose state it is — the node's (in the project), or the module's folder
        // (in the workspace) for a sole use — `dir` is already absolute, `nodes/` is not.
        const at = ins.node
          ? join(outDir, `nodes/${ins.node}.vstpreset`)
          : join(dir, `${b.name}.vstpreset`);
        writeFile(at, assets[ins.preset]);
        modulePresetFiles++;
      }
    }
  }

  const p = song.project;
  writeFile(
    join(outDir, "project.yaml"),
    yamlText({
      project: {
        name: p.name,
        tempo: p.tempo,
        sampleRate: p.sampleRate,
        timeSignature: p.timeSignature,
      },
    }),
  );

  // The surface an imported project needs to be LOOKED at: a foreign project IS an arrangement —
  // tracks and clips against a ruler — and a folder that declares none draws no lanes, no transport
  // and no minimap. See packages/song/docs/surfaces.md.
  writeFile(
    join(outDir, "surfaces/timeline.yaml"),
    `# The ARRANGEMENT — the timeline, and the transport that rolls through it.\n` +
      `#\n` +
      `# Written by the import: what a .dawproject or .als carries is lanes on a ruler, so the\n` +
      `# project that comes out of one draws them. Delete this file and the song still compiles\n` +
      `# and still plays; you simply have no lanes on screen.\n` +
      `type: timeline\n` +
      `layout: split\n`,
  );

  // No format pass: the emitter's output is canonical as written.

  return {
    trackFiles,
    clipFiles,
    sequenceFiles,
    chainFiles: Object.keys(chains).length,
    moduleNodes,
    nodeFiles,
    modulePresetFiles,
    missingAudio,
    missingPlugins: [...missingPlugins],
    standIns,
  };
}

const tsNum = (s: Song): number =>
  parseInt(s.project.timeSignature.split("/")[0], 10) || 4;
const tsDen = (s: Song): number =>
  parseInt(s.project.timeSignature.split("/")[1], 10) || 4;
