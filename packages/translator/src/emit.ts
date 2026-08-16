// emit.ts — write a Song (from dawproject.ts) out as a node/track/chain project: a
// project.yaml + graph.yaml, one self-contained module folder per plugin, and
// tracks/clips/sequences. No schema file ships with it — a project is validated in
// process against the loader's own schemas. Layout + mapping: docs/import.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { materialWindow } from "@studio/song/materialWindow";
import { beatsToDuration, beatsToPosition } from "@studio/song/timecode";
import { quoteTimecodes } from "@studio/song/yaml/moduleFile";
import { isSeq, parseDocument } from "yaml";
import type { ClipOut, PluginOut, Song, TrackOut } from "./model.js";

// --- YAML emitters -----------------------------------------------------------
// The `yaml` package prints; here live the SHAPE decisions, matching what l8 itself writes: a placement,
// chain node or note stays on ONE line, and every timecode is QUOTED — bare, `25:1` is a YAML 1.1 sexagesimal.

/**
 * A YAML document from a plain value, with `flow` set on the nodes at `flowPaths` — a LIST's items, so a list of
 * placements comes out one per line, and `selfPaths`' own node, so a node's destinations stay on ONE line.
 */
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
  if (typeof content === "string") writeFileSync(path, content, "utf8");
  else writeFileSync(path, content);
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
function loadCachedPluginNames(): Set<string> {
  const names = new Set<string>();
  const file = join(homedir(), ".studio", "exts.json");
  if (!existsSync(file)) return names;
  try {
    const root = JSON.parse(readFileSync(file, "utf8"));
    for (const e of root.entries ?? [])
      for (const p of e.plugins ?? [])
        if (p?.name) names.add(String(p.name).toLowerCase());
  } catch {
    /* ignore a corrupt cache */
  }
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
// A self-contained module: its plugin inline plus concrete params, one module per PLUGIN and one insert per use.
// A plugin used several times becomes nodes rather than the "reverb_2, reverb_3" pile imports used to make.
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

/**
 * The chains as SEGMENTS — who feeds whom, which is what graph.yaml holds.
 *
 * This is where the imported sends survive. The list format gave a chain ONE sink, so a track that was dry to
 * master AND feeding a bus had to lose one of the two; a node here simply lists both destinations. `to` naming
 * another chain resolves to the module that chain starts at, since a chain is no longer something to route to
 * by name.
 */
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
  },
  num: number,
  den: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ref: p.ref,
    start: beatsToPosition(p.start, num, den),
  };
  // The clip's extent is NOT written here: it belongs to the material, as a `from`/`to` window in the clip's or
  // sequence's own file (see materialWindow). All the placement adds is how many times that window is played.
  if (p.loops > 1) out.loop = p.loops;
  const opt = (k: string, v?: number) => {
    if (v) out[k] = beatsToDuration(v, num, den);
  }; // drop zeros
  opt("fadeIn", p.fadeIn);
  opt("fadeOut", p.fadeOut);
  return out;
}

// The window a clip/sequence file declares, as the two quoted POSITION timecodes the schemas take. A window that
// starts at the material's own beginning says so by omission, which is how a hand would write it.
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

// A track holding any MIDI is a "sequences" track, anything else audio; one holding BOTH has no valid shape here.
const contentTypeOf = (t: TrackOut): "audio" | "sequences" =>
  (t.clips ?? []).some((c) => c.type === "midi") ? "sequences" : "audio";

const isMixed = (t: TrackOut): boolean => {
  const clips = t.clips ?? [];
  return (
    clips.some((c) => c.type === "midi") && clips.some((c) => c.type !== "midi")
  );
};

function trackText(t: TrackOut, placements: Record<string, unknown>[]): string {
  // No `name` field: the FILE names the lane, and `t.name` drives the slug, so the display name is that slug.
  //
  // A lane is a NODE of one of the five built-in track modules now, so `type:` and
  // `contentType:` are one `extends:` — which signal it carries is what it extends. Its mute is
  // its module's bypass and goes to graph.yaml, not here. See packages/song/docs/trackModules.md.
  const value: Record<string, unknown> = {};
  if (t.color) value.color = t.color;
  value.extends =
    contentTypeOf(t) === "sequences"
      ? "@studio/sequence-track"
      : "@studio/audio-track";
  // The lane file's own key — `events:`, not `clips:`. A clip is the material in
  // clips/<id>.yaml; these are placements of it. See song/yaml/moduleSchema.
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
  missingPlugins: string[]; // referenced but not in the l8 cache -> stubbed
  // Tracks given both audio and MIDI: they import as "sequences", and their audio won't load until split by hand.
  mixedTracks: string[];
}

export function emitFolder(
  outDir: string,
  song: Song,
  assets: Record<string, Uint8Array>,
): EmitStats {
  mkdirSync(outDir, { recursive: true });
  // The stereo-output sink is a module like any other; module files are evaluated on their own, so no package clause.
  writeFile(
    join(outDir, "modules/io/OUT/module.yaml"),
    yamlText({ io: "out" }),
  );

  // Plugin state is written as a .vstpreset beside whichever file owns it — the node's, or the
  // module's when the single use folded back into module.yaml. Audio is relocated separately.

  // Unique name-slug per track (used as track id, chain entry name, send target).
  const usedTrackSlugs = new Set<string>();
  const slugOf = new Map<string, string>();
  for (const t of song.tracks)
    slugOf.set(t.id, uniquify(slugify(t.name), usedTrackSlugs));

  // A node is FLAT now — `nodes/<name>.yaml`, named by its file alone
  // (packages/song/docs/nodes.md). So a node shares ONE namespace with the lanes and the
  // modules a chain step may equally name, and uniqueness has to hold across all three.
  const usedNodeNames = new Set<string>(usedTrackSlugs);

  // A plugin's type folder from its role. `transformers`, not the legacy alias `midi`: an import creates fresh
  // folders, so writing the old name gave every imported song a legacy layout on day one.
  const typeFolderOf = (role?: string): string =>
    role === "instrument"
      ? "instruments"
      : role === "noteFX"
        ? "transformers"
        : "audio";

  // Modules keyed by the PLUGIN, not its settings: every use adds an insert, and the single-use case folds back
  // into module.yaml at the end — so an import only pays for nodes where settings really differ.
  const usedModuleNames = new Set<string>();
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
    // A sole use folds back into module.yaml below, and the chain then names the module — so the
    // module's own name is taken as far as a node is concerned.
    usedNodeNames.add(mod.name.toLowerCase());
    // Each insert gets its OWN node even when identically set: they are separate slots, and sharing one would
    // make tweaking the vocal's reverb silently retune the drums'.
    const node = uniquify(`${mod.name}_${owner}`, usedNodeNames);
    mod.inserts.push({ node, params, preset });
    return node;
  };

  // Master → OUT (or a master chain if it carries plugins).
  const master = song.tracks.find((t) => t.role === "master");
  const masterPlugins = orderPlugins(master?.plugins ?? []);
  const masterSink =
    master && masterPlugins.length ? slugOf.get(master.id)! : "OUT";

  const chains: Record<string, ChainDef> = {};
  const busChains = new Set<string>(); // return-bus chains (no `from`, fed by sends)
  const usedChainNames = new Set<string>(["out"]); // avoid a chain literally named OUT
  const usedClipIds = new Set<string>();
  let clipFiles = 0;
  let sequenceFiles = 0;
  const missingAudio: string[] = [];
  const mixedTracks: string[] = [];

  // One chain per source: its ordered plugins become `use` steps, each naming a module node, routed to `terminal`.
  const addChain = (
    entry: string,
    fromTrack: string | undefined,
    plugins: PluginOut[],
    terminal: OutDef[],
  ) => {
    usedChainNames.add(entry.toLowerCase());
    chains[entry] = {
      from: fromTrack,
      use: orderPlugins(plugins).map((p) => ({
        // The chain names a NODE; collapseSoleInserts rewrites it to the bare module when the plugin is used once.
        module: moduleRefFor(p, entry),
        enabled: p.enabled ? undefined : false,
      })),
      out: terminal,
    };
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
            { ref: cid, start: c.start, loops: w.loops },
            tsNum(song),
            tsDen(song),
          ),
        );
        sequenceFiles++;
      } else {
        const ext = extname(c.source ?? "") || ".wav";
        const wavRel = `clips/${cid}${ext}`;
        const bytes = c.source ? assets[c.source] : undefined;
        if (bytes) writeFile(join(outDir, wavRel), bytes);
        else missingAudio.push(cid);
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

    addChain(slug, isBus ? undefined : slug, plugins, terminal);
    if (isBus) busChains.add(slug);

    if (!isBus) {
      if (isMixed(t)) mixedTracks.push(slug);
      writeFile(
        join(outDir, `nodes/${slug}.yaml`),
        trackText(t, emitArrangement(t, slug)),
      );
      trackFiles++;
    }
  }

  // Master chain (only if it has plugins; else masterSink is already "OUT").
  if (master && masterPlugins.length)
    addChain(slugOf.get(master.id)!, undefined, masterPlugins, [{ to: "OUT" }]);

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

  // A plugin used in exactly ONE place needs no node: fold it into module.yaml, so the common import reads
  // exactly as it did before nodes existed.
  const collapseSoleInserts = () => {
    for (const mod of modules) {
      if (mod.inserts.length !== 1) continue;
      const [only] = mod.inserts;
      const from = only.node;
      only.node = ""; // "" == the state lives in module.yaml
      for (const d of Object.values(chains))
        for (const step of d.use)
          if (step.module === from) step.module = mod.name;
    }
  };
  collapseSoleInserts();

  // graph.yaml — SEGMENTS (see chainSegments). The send LEVELS are still lost: a
  // destination list says where the signal goes, not how much of it, so a weighted send
  // arrives at full strength.
  const {
    tracks: chainTracks,
    modules: chainModules,
    bypassed,
  } = chainSegments(chains);
  const weighted = Object.values(chains).reduce(
    (n, d) => n + d.out.filter((o) => o.gain != null && o.gain !== 1).length,
    0,
  );
  // ONE map, lanes first: a lane is a module too (packages/song/docs/trackModules.md), and
  // putting the runs' sources at the top is what makes the file read the way the signal flows.
  const chainNodes = { ...chainTracks, ...chainModules };
  const seg: Record<string, unknown> = {};
  if (Object.keys(chainNodes).length) seg.modules = chainNodes;
  // A lane the import found MUTED is bypassed, which is where a lane's mute lives now.
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

  // Which modules survive: one whose every insert was orphaned has nothing left to write.
  const liveModules = modules.filter((b) => b.inserts.length > 0);

  // Modules -> module.yaml plus one nodes/<node>.yaml per insert when used more than once. Each file is a FLAT struct
  // with no `name:` and no package wrapper. Opaque state rides as <node>.vstpreset, the convention the brain
  // resolves; a plugin the cache doesn't know is written as a stub the chain simply routes through.
  const cachedNames = loadCachedPluginNames();
  const verify = cachedNames.size > 0; // nothing to check against without a scan
  const missingPlugins = new Set<string>();
  let modulePresetFiles = 0;
  let nodeFiles = 0;
  for (const b of liveModules) {
    const dir = `modules/${b.folder}/${b.name}`;
    const known = !verify || cachedNames.has(b.pluginName.toLowerCase());
    // No `type` is what makes it a stub: the brain skips instantiating it and the chain routes through.
    const value: Record<string, unknown> = {
      plugin: known
        ? { type: b.pluginType, name: b.pluginName }
        : { name: b.pluginName },
    };
    // A sole insert's state belongs in module.yaml (node === "").
    const sole = b.inserts.length === 1 && b.inserts[0].node === "";
    if (sole) {
      const params = paramsOf(b.inserts[0].params);
      if (params) value.params = params;
    }
    let note: string | undefined;
    if (!known) {
      missingPlugins.add(b.pluginName);
      note =
        `MISSING PLUGIN: "${b.pluginName}" (${b.pluginType}) is not in the l8 plugin cache.\n` +
        `Stub — routing only, does nothing. Install/scan the plugin ('l8 engine scan')\n` +
        `and re-import, or set a real plugin.type below.`;
    } else if (!sole) {
      note =
        `${b.pluginName} — used ${b.inserts.length} times in this song, so each use is a\n` +
        `NODE in nodes/ that extends this module. The plugin is declared once here;\n` +
        `each node carries only its own settings.`;
    }
    writeFile(join(outDir, `${dir}/module.yaml`), yamlText(value, [], note));

    for (const ins of b.inserts) {
      if (ins.node) {
        const params = paramsOf(ins.params);
        // A node is a flat file naming what it extends — never a leaf beside the module it
        // uses, which is the layout packages/song/docs/nodes.md dropped.
        writeFile(
          join(outDir, `nodes/${ins.node}.yaml`),
          yamlText(
            {
              extends: `@project/${b.folder}/${b.name}`,
              ...(params ? { params } : {}),
            },
            [],
            `${ins.node} — inherits ${b.name} (the plugin); only what this use sets differs.`,
          ),
        );
        nodeFiles++;
      }
      if (ins.preset && assets[ins.preset]) {
        // Beside the file whose state it is: nodes/<node>.vstpreset for a node, and the
        // module's own folder for the sole use that stayed in module.yaml.
        const at = ins.node
          ? `nodes/${ins.node}.vstpreset`
          : `${dir}/${b.name}.vstpreset`;
        writeFile(join(outDir, at), assets[ins.preset]);
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

  // No format pass: the emitter's output is canonical as written.

  return {
    trackFiles,
    clipFiles,
    sequenceFiles,
    chainFiles: Object.keys(chains).length,
    moduleNodes: liveModules.length,
    nodeFiles,
    modulePresetFiles,
    missingAudio,
    missingPlugins: [...missingPlugins],
    mixedTracks,
  };
}

const tsNum = (s: Song): number =>
  parseInt(s.project.timeSignature.split("/")[0], 10) || 4;
const tsDen = (s: Song): number =>
  parseInt(s.project.timeSignature.split("/")[1], 10) || 4;
