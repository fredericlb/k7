// emitNaming.ts — what every part of the emitter shares: the YAML text it writes, the slugs it names
// files by, and EmitCtx, the one bag of name spaces and counters an import fills as it goes.
// The name spaces are SHARED on purpose: a lane, a module and a node can never take one name twice.

import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SHARED_MODULES_PATH } from "@studio/song/sharedFolders";
import { wsWrite } from "@studio/song/yaml/workspaceFile";
import { quoteTimecodes } from "@studio/song-schema/yaml/moduleFile";
import { YAML_READ, YAML_WRITE } from "@studio/song-schema/yaml/yamlText";
import { isSeq, parseDocument } from "yaml";
import type { Song } from "./model.js";

// --- YAML emitters -----------------------------------------------------------

// The SHAPE decisions, matching what k7 itself writes — see docs/import.md.

/** A YAML document with `flow` set on `flowPaths`' items and on `selfPaths`' own node. */
function yamlDoc(
  value: unknown,
  flowPaths: (string | number)[][] = [],
  selfPaths: (string | number)[][] = [],
): ReturnType<typeof parseDocument> {
  const doc = parseDocument("{}", YAML_READ);
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
export function yamlText(
  value: unknown,
  flowPaths: (string | number)[][] = [],
  note?: string,
  selfPaths: (string | number)[][] = [],
): string {
  // A note carries names from the imported file: a `\r` or another control character would end the comment early.
  const head = note
    ? `${note
        .split(/\r\n|[\r\n\u0085\u2028\u2029]/)
        // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
        .map((l) => `# ${l.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")}`)
        .join("\n")}\n`
    : "";
  return head + yamlDoc(value, flowPaths, selfPaths).toString(YAML_WRITE);
}

/** A param map, or undefined when there is nothing to write. */
export const paramsOf = (
  p?: Record<string, number>,
): Record<string, number> | undefined =>
  p && Object.keys(p).length ? p : undefined;

// --- filesystem + slugs ------------------------------------------------------

export function writeFile(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  // Through the workspace door, so an imported project is written in the format new files take (song's k7xFiles.md).
  wsWrite(path, content);
}

// Real name -> a snake_case, filesystem-safe base. Every file created on import is named this way.
export function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "node";
}
export function uniquify(base: string, used: Set<string>): string {
  let s = base;
  let n = 2;
  while (used.has(s.toLowerCase())) s = `${base}_${n++}`; // stay snake_case on collision
  used.add(s.toLowerCase());
  return s;
}

export const tsNum = (s: Song): number =>
  parseInt(s.project.timeSignature.split("/")[0], 10) || 4;
export const tsDen = (s: Song): number =>
  parseInt(s.project.timeSignature.split("/")[1], 10) || 4;

// --- the shapes an import builds before it writes them ------------------------

interface Step {
  module: string; // a module node name (params live on the module, not here)
  enabled?: boolean; // undefined => on
}
export interface OutDef {
  to: string;
  gain?: number; // undefined or 1 => the whole signal; <1 => a weighted send
}
export interface ChainDef {
  from?: string;
  use: Step[]; // ordered module nodes (source -> use[0] -> use[1] -> … -> out)
  enabled?: boolean; // undefined => on
  out: OutDef[];
}
// A self-contained module: one per PLUGIN, one insert per use — see docs/import.md.
export interface ModuleDef {
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

/** Everything one import shares between its parts: the name spaces, what it built, what it counted. */
export interface EmitCtx {
  outDir: string;
  song: Song;
  assets: Record<string, Uint8Array>;
  /** Track id -> its unique slug (the track id, chain entry name and send target). */
  slugOf: Map<string, string>;
  /** A flat node shares ONE namespace with the lanes and the modules — packages/song/docs/nodes.md. */
  usedNodeNames: Set<string>;
  usedChainNames: Set<string>;
  usedClipIds: Set<string>;
  usedModuleNames: Set<string>;
  /** The workspace's `_modules`, where an imported module lands. */
  workspaceModulesDir: string;
  moduleOf: Map<string, ModuleDef>;
  modules: ModuleDef[];
  chains: Record<string, ChainDef>;
  /** Return-bus chains (no `from`, fed by sends). */
  busChains: Set<string>;
  /** Content hash -> where those bytes landed, and the file names already taken. */
  audioRel: Map<string, string>;
  takenAudio: Set<string>;
  missingAudio: string[];
  standIns: number;
  clipFiles: number;
  sequenceFiles: number;
}

/** A fresh context, its name spaces seeded with the lanes' slugs and the workspace's modules. */
export function newEmitCtx(
  outDir: string,
  song: Song,
  assets: Record<string, Uint8Array>,
): EmitCtx {
  // Unique name-slug per track (used as track id, chain entry name, send target).
  const usedTrackSlugs = new Set<string>();
  const slugOf = new Map<string, string>();
  for (const t of song.tracks)
    slugOf.set(t.id, uniquify(slugify(t.name), usedTrackSlugs));

  // Seeded with the workspace's `_modules`: an import must not silently reuse or shadow another song's module.
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

  return {
    outDir,
    song,
    assets,
    slugOf,
    usedNodeNames: new Set<string>(usedTrackSlugs),
    usedChainNames: new Set<string>(["out"]), // avoid a chain literally named OUT
    usedClipIds: new Set<string>(),
    usedModuleNames,
    workspaceModulesDir,
    moduleOf: new Map<string, ModuleDef>(),
    modules: [],
    chains: {},
    busChains: new Set<string>(),
    audioRel: new Map<string, string>(),
    takenAudio: new Set<string>(),
    missingAudio: [],
    standIns: 0,
    clipFiles: 0,
    sequenceFiles: 0,
  };
}
