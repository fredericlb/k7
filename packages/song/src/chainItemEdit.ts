// chainItemEdit.ts — editing ONE node of a chain project, whose text is an item inside a chain file,
// with the same text transforms a node file is edited with. The item is cut out as a YAML document,
// transformed, and spliced back by its `id`: the rest of the chain file, comments included, is left.
// What would be got wrong: a transform sees the whole item, but `id`, `bypass`, `vstpreset` and
// `mapping` are the USE's — whatever it does to them is undone. See docs/chainFiles.md.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseChain, stepSeqs } from "@studio/song-schema/yaml/chainFile";
import {
  CHAINS_DIR,
  isTrackItem,
  itemsOf,
  NODE_ITEM_KEYS,
  stepLists,
  TRACKS_DIR,
} from "@studio/song-schema/yaml/chainSchema";
import {
  Document,
  isMap,
  isSeq,
  parseDocument,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import { isChainProject, readChainProject } from "./chainProject";
import { entityFileFor, type ModuleFile } from "./yaml/moduleIO";

const OPTS = { version: "1.2" as const, strict: false };
const OUT = { lineWidth: 0 };

/** The folder a project keeps its LANES' files in: `tracks/` in a chain project, `nodes/` otherwise. */
export const laneFolder = (dir: string): string =>
  isChainProject(dir) ? TRACKS_DIR : "nodes";

/** A lane's own file — the one place its events, takes and alternatives are written — or null. */
export function laneFileFor(dir: string, lane: string): ModuleFile | null {
  const sub = laneFolder(dir);
  return entityFileFor(join(dir, sub), sub, lane);
}

/** Where a chain node's item sits: its chain file, and the path of its map inside that file. */
export interface ChainItemRef {
  chain: string;
  path: string;
  id: string;
}

/** The chain item a non-lane node `name` is, or null — a lane is a file of its own (laneFileFor). */
export function chainItemOf(dir: string, name: string): ChainItemRef | null {
  if (!isChainProject(dir)) return null;
  const n = readChainProject(dir).nodes[name];
  if (!n || n.track) return null;
  const path = join(dir, CHAINS_DIR, `${n.chain}.yaml`);
  const alt = join(dir, CHAINS_DIR, `${n.chain}.yml`);
  return { chain: n.chain, path: existsSync(path) ? path : alt, id: n.id };
}

/** The item's map node inside a parsed chain file, found by its `id`. */
function itemNode(doc: Document, id: string): YAMLMap | null {
  for (const steps of stepSeqs(doc))
    for (const s of steps.items) {
      const maps = isSeq(s) ? s.items : [s];
      for (const m of maps)
        if (isMap(m) && m.get("id") === id) return m as YAMLMap;
    }
  return null;
}

/** The parent sequence holding the item and its index there, so the node can be REPLACED in place. */
function slotOf(
  doc: Document,
  target: YAMLMap,
): { seq: YAMLSeq; index: number } | null {
  for (const top of stepSeqs(doc))
    for (let i = 0; i < top.items.length; i++) {
      const s = top.items[i];
      if (s === target) return { seq: top, index: i };
      if (isSeq(s)) {
        const k = (s as YAMLSeq).items.indexOf(target);
        if (k >= 0) return { seq: s as YAMLSeq, index: k };
      }
    }
  return null;
}

/** The item as a standalone YAML document's text — block style, its leading comment left in the chain file. */
function standalone(node: YAMLMap): string {
  const copy = node.clone() as YAMLMap;
  copy.flow = false;
  copy.commentBefore = undefined;
  const doc = new Document(undefined, OPTS);
  doc.contents = copy as unknown as typeof doc.contents;
  return doc.toString(OUT);
}

/** The text a node file would hold for this chain node — what a reader of the module's text wants. */
export function chainItemText(dir: string, name: string): string {
  const ref = chainItemOf(dir, name);
  if (!ref) throw new Error(`no chain node '${name}' in this project`);
  const doc = parseDocument(readFileSync(ref.path, "utf8"), OPTS);
  const node = itemNode(doc, ref.id);
  if (!node)
    throw new Error(`${CHAINS_DIR}/${ref.chain}.yaml holds no item ${ref.id}`);
  return standalone(node);
}

/** Run a node-file transform over a chain node's item and splice the result back; the chain file's path. */
export function editChainItem(
  dir: string,
  name: string,
  transform: (text: string) => string,
): string {
  const ref = chainItemOf(dir, name);
  if (!ref) throw new Error(`no chain node '${name}' in this project`);
  const before = readFileSync(ref.path, "utf8");
  const after = spliceChainItem(before, ref.id, transform);
  if (after !== before) writeFileSync(ref.path, after, "utf8");
  return ref.path;
}

/** The pure half of editChainItem: chain file text in, chain file text out, refused if it no longer parses. */
export function spliceChainItem(
  chainText: string,
  id: string,
  transform: (text: string) => string,
): string {
  const doc = parseDocument(chainText, OPTS);
  const node = itemNode(doc, id);
  if (!node) throw new Error(`no item ${id} in this chain`);
  const text = standalone(node);
  const next = transform(text);
  if (next === text) return chainText;
  const edited = parseDocument(next, OPTS);
  const fresh = edited.contents as unknown as YAMLMap<unknown, unknown>;
  if (!isMap(fresh))
    throw new Error(`node ${id}: an edit left it not a mapping`);
  // The use's own keys are put back as they were: a module edit never moves, bypasses or re-ids a node.
  for (const k of NODE_ITEM_KEYS) {
    const was = node.get(k, true);
    if (was === undefined) fresh.delete(k);
    else fresh.set(k, was);
  }
  fresh.commentBefore = node.commentBefore;
  const slot = slotOf(doc, node);
  if (!slot) throw new Error(`no item ${id} in this chain`);
  slot.seq.items[slot.index] = fresh;
  const out = doc.toString(OUT);
  const parsed = parseChain(out);
  if (!parsed.value)
    throw new Error(
      `node ${id}: the edit would make its chain unreadable — ${parsed.issues[0]?.path ?? ""} ${parsed.issues[0]?.message ?? ""}`.trim(),
    );
  return out;
}

/** The ids of a chain file's node items that hold events of their own — what a time edit has to reach. */
export function eventItemIds(chainText: string): string[] {
  const c = parseChain(chainText).value;
  if (!c) return [];
  return stepLists(c)
    .flatMap((l) => l.steps.flatMap(itemsOf))
    .filter(
      (i) =>
        !isTrackItem(i) &&
        ("events" in i || "alternatives" in i || "takes" in i),
    )
    .map((i) => i.id);
}

/** Every chain file of a project, project-relative — none for a project of segments. */
export function chainFiles(dir: string): string[] {
  if (!isChainProject(dir)) return [];
  const d = join(dir, CHAINS_DIR);
  return readdirSync(d)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort()
    .map((f) => `${CHAINS_DIR}/${f}`);
}
