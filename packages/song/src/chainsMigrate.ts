// chainsMigrate.ts — rewrite a project's graph.yaml from the old chain-LIST format into
// segments (one `modules:` map). A one-shot, re-runnable: a file already in the new shape is
// left alone, so running it twice is a no-op. See docs/graphFile.md.

import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { formatChains } from "@studio/song-schema/yaml/graphFile";
import type { GraphFile } from "@studio/song-schema/yaml/graphSchema";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { parse } from "yaml";

/** One module the old file used in several chains, and the nodes it became. */
export interface SplitModule {
  module: string;
  nodes: string[]; // "synth:melody", "synth:pad" — one per chain that used it
}

export interface ChainsMigration {
  text: string;
  /** False when the file was already segments — nothing was rewritten. */
  changed: boolean;
  split: SplitModule[];
  /** The old file's TRACKS — the one moment that knowledge exists, see docs/trackModules.md. */
  tracks: string[];
  notes: string[];
}

const HEADER =
  `# The signal graph, as SEGMENTS: each module says where its signal goes next — the\n` +
  `# lanes included, since a lane is a module too. The chains are DERIVED by following\n` +
  `# the arrows — a run breaks where the signal splits, and where two signals meet (which\n` +
  `# is what a bus is).\n` +
  `#\n` +
  `# \`bypassed\` lists the modules the signal passes through untouched, and on a lane that\n` +
  `# is its mute.\n`;

/** A node name the module loader accepts: letters, digits, '_' and '-'. A chain called `da.main` becomes `da_main`. */
const nodeName = (chain: string): string =>
  chain.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^$/, "x");

interface OldChain {
  name: string;
  from?: string;
  steps: string[]; // the modules the signal passes THROUGH
  target?: string; // the last node: a sink, or another chain
  bypassed: Set<string>;
}

/** Read the old list format into something addressable. Deliberately lenient — this runs once, on files it did not write. */
function readOld(raw: unknown): OldChain[] | null {
  const chains = (raw as { chains?: unknown })?.chains;
  if (!Array.isArray(chains)) return null;
  const out: OldChain[] = [];
  chains.forEach((c, i) => {
    if (!Array.isArray(c)) return;
    const nodes = c.filter((n) => n && typeof n === "object") as Record<
      string,
      unknown
    >[];
    const head = nodes.find((n) => "track" in n || "chain" in n);
    const flow = nodes.filter((n) => "module" in n);
    const pick = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    const from = pick(head?.track);
    const name =
      pick(head?.as) ?? pick(head?.chain) ?? from ?? `chain_${i + 1}`;
    const bypassed = new Set<string>();
    for (const n of flow)
      if (n.enabled === false) bypassed.add(String(n.module));
    const names = flow.map((n) => String(n.module));
    out.push({
      name,
      from,
      steps: names.slice(0, -1),
      target: names[names.length - 1],
      bypassed,
    });
  });
  return out;
}

/** Rewrite one graph.yaml's text; a module used in SEVERAL chains splits into one node per chain, or they sum. */
export function migrateChainsText(text: string): ChainsMigration {
  const raw = parse(text, { version: "1.2" }) ?? {};
  const old = readOld(raw);
  if (!old) return { text, changed: false, split: [], tracks: [], notes: [] };

  // Which chains use each module as a STEP — a target is a destination, not a node.
  const users = new Map<string, string[]>();
  for (const c of old)
    for (const m of c.steps) {
      const seen = users.get(m);
      if (seen) {
        if (!seen.includes(c.name)) seen.push(c.name);
      } else users.set(m, [c.name]);
    }
  const split: SplitModule[] = [];
  const shared = new Set<string>();
  for (const [m, chains] of users)
    if (chains.length > 1) {
      shared.add(m);
      split.push({
        module: m,
        nodes: chains.map((c) => `${m}:${nodeName(c)}`),
      });
    }
  const rename = (module: string, chain: string): string =>
    shared.has(module) ? `${module}:${nodeName(chain)}` : module;

  const byName = new Map(old.map((c) => [c.name, c]));
  /** The node a destination really points at: a chain name resolves to the first node of that chain. */
  const resolve = (
    to: string | undefined,
    notes: string[],
  ): string | undefined => {
    if (!to) return undefined;
    const c = byName.get(to);
    if (!c) return to; // a sink (OUT), or a module — either way, itself
    if (c.steps.length) return rename(c.steps[0], c.name);
    if (c.target && c.target !== to) return resolve(c.target, notes);
    notes.push(`chain '${to}' has nothing to route into`);
    return undefined;
  };

  const notes: string[] = [];
  const tracks: Record<string, string[]> = {};
  const modules: Record<string, string[]> = {};
  const bypassed: string[] = [];
  const feed = (into: Record<string, string[]>, node: string, to?: string) => {
    into[node] ??= [];
    const list = into[node];
    if (to && !list.includes(to)) list.push(to);
  };

  for (const c of old) {
    const path = c.steps.map((m) => rename(m, c.name));
    const end = resolve(c.target, notes);
    if (c.from) feed(tracks, c.from, path[0] ?? end);
    else if (path.length)
      feed(modules, path[0]); // a bus's first node exists even before anything feeds it
    else if (end) feed(modules, end); // a lone module: placed, wired to nothing
    for (let i = 0; i < path.length; i++)
      feed(modules, path[i], i + 1 < path.length ? path[i + 1] : end);
    for (const m of c.bypassed) bypassed.push(rename(m, c.name));
  }

  // ONE map, lanes first, so the file reads top-down the way the signal flows (docs/trackModules.md).
  const file: GraphFile = { modules: { ...tracks, ...modules } };
  if (bypassed.length) file.bypassed = bypassed;
  return {
    text: formatChains(file, HEADER),
    changed: true,
    split,
    tracks: Object.keys(tracks),
    notes,
  };
}

export interface ChainsMigrationResult extends ChainsMigration {
  /** The node files created for a split module, project-relative. */
  created: string[];
  errors: string[];
}

/** Migrate the project at `dir`, writing graph.yaml and the empty node file each split needs. */
export function migrateChains(dir: string): ChainsMigrationResult {
  const path = join(dir, GRAPH_FILE);
  const out: ChainsMigrationResult = {
    text: "",
    changed: false,
    split: [],
    tracks: [],
    notes: [],
    created: [],
    errors: [],
  };
  if (!existsSync(path)) {
    out.errors.push("no graph.yaml");
    return out;
  }
  const before = readFileSync(path, "utf8");
  const r = migrateChainsText(before);
  Object.assign(out, r);
  if (!r.changed) return out;
  // The old file, kept beside the new: nothing else can rebuild how the song is wired.
  if (!existsSync(`${path}.bak`)) copyFileSync(path, `${path}.bak`);

  for (const s of r.split) {
    // Only a project-local module has a folder here; splitting a shared one changes every song using it.
    if (s.module.startsWith("@")) {
      out.errors.push(
        `'${s.module}' is a shared module used by ${s.nodes.length} chains — ` +
          `it is now ONE node fed by all of them. Fork it per chain if they need separate plugins.`,
      );
      continue;
    }
    for (const inst of s.nodes) {
      const [, name] = inst.split(":");
      const folder = moduleFolder(dir, s.module);
      if (!folder) {
        out.errors.push(
          `no folder for module '${s.module}' — '${inst}' has nothing to inherit`,
        );
        continue;
      }
      const file = join(folder, `${name}.yaml`);
      if (existsSync(file)) continue;
      writeFileSync(
        file,
        `# "${inst}" — one use of "${s.module}", so it has its own plugin and its own state.\n` +
          `# Everything it plays is inherited; add \`params:\` to change this one alone.\n`,
        "utf8",
      );
      out.created.push(`modules/${relOf(dir, folder)}/${name}.yaml`);
    }
  }
  writeFileSync(path, r.text, "utf8");
  return out;
}

/** The `modules/<category>/<module>` folder holding a module, found by looking for its module file. */
function moduleFolder(dir: string, module: string): string | null {
  const root = join(dir, "modules");
  if (!existsSync(root)) return null;
  for (const category of readdirSafe(root)) {
    const folder = join(root, category, module);
    if (existsSync(join(folder, "module.yaml"))) return folder;
  }
  return null;
}

const relOf = (dir: string, folder: string): string =>
  folder
    .slice(join(dir, "modules").length + 1)
    .split(/[\\/]/)
    .join("/");

function readdirSafe(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}
