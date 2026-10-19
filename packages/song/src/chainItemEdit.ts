// chainItemEdit.ts — editing ONE node of a chain project, whose text is an item inside a chain file,
// with the same writers a node file is edited with: they get a scope rooted at the item, found by its `id`.
// What would be got wrong: a writer sees the whole item, but `id`, `bypass`, `vstpreset` and
// `mapping` are the USE's — whatever it does to them is undone. See docs/chainFiles.md.

import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { K7Path } from "@studio/k7x/ast";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import { stringify } from "@studio/k7x/print";
import { isDocFile } from "@studio/song-schema/docExt";
import { chainItemPaths, parseChain } from "@studio/song-schema/yaml/chainFile";
import {
  CHAINS_DIR,
  isTrackItem,
  itemsOf,
  NODE_ITEM_KEYS,
  stepLists,
  TRACKS_DIR,
} from "@studio/song-schema/yaml/chainSchema";
import {
  chainFilePath,
  isChainProject,
  readChainProject,
} from "./chainProject";
import { entityFileFor, type ModuleFile } from "./yaml/moduleIO";
import { wsText, wsWriteText } from "./yaml/workspaceDoc";

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
  return { chain: n.chain, path: chainFilePath(dir, n.chain), id: n.id };
}

/** The path of the item `id` inside a chain document, or null. */
export const chainItemPath = (doc: K7Document, id: string): K7Path | null =>
  chainItemPaths(doc).find((i) => i.id === id)?.path ?? null;

/** The k7x text a node file would hold for this chain node — what a reader of the module's text wants. */
export function chainItemText(dir: string, name: string): string {
  const ref = chainItemOf(dir, name);
  if (!ref) throw new Error(`no chain node '${name}' in this project`);
  const doc = new K7Document(wsText(ref.path));
  const at = chainItemPath(doc, ref.id);
  if (!at)
    throw new Error(`${relative(dir, ref.path)} holds no item ${ref.id}`);
  return stringify(doc.getIn(at));
}

/** Run a node-file writer over a chain node's item and write the chain file back; the chain file's path. */
export function editChainItem(
  dir: string,
  name: string,
  edit: (item: K7Scope) => void,
): string {
  const ref = chainItemOf(dir, name);
  if (!ref) throw new Error(`no chain node '${name}' in this project`);
  const before = wsText(ref.path);
  const after = spliceChainItem(before, ref.id, edit);
  if (after !== before) wsWriteText(ref.path, after);
  return ref.path;
}

/** The same edit on a chain document held in memory, refused when the chain would no longer read. */
export function editChainItemIn(
  doc: K7Document,
  id: string,
  edit: (item: K7Scope) => void,
): void {
  const at = chainItemPath(doc, id);
  if (!at) throw new Error(`no item ${id} in this chain`);
  const kept = NODE_ITEM_KEYS.map((k) => ({
    k,
    has: doc.hasIn([...at, k]),
    json: JSON.stringify(doc.getIn([...at, k])),
    value: doc.getIn([...at, k]),
  }));
  const before = doc.toString();
  edit(doc.at(at));
  if (doc.toString() === before) return;
  // The use's own keys are put back as they were: a module edit never moves, bypasses or re-ids a node.
  for (const { k, has, json, value } of kept)
    if (!has) doc.deleteIn([...at, k]);
    else if (JSON.stringify(doc.getIn([...at, k])) !== json)
      doc.setIn([...at, k], value);
  const parsed = parseChain(doc.toString());
  if (!parsed.value)
    throw new Error(
      `node ${id}: the edit would make its chain unreadable — ${parsed.issues[0]?.path ?? ""} ${parsed.issues[0]?.message ?? ""}`.trim(),
    );
}

/** The pure half of editChainItem: chain file text in, chain file text out. */
export function spliceChainItem(
  chainText: string,
  id: string,
  edit: (item: K7Scope) => void,
): string {
  const doc = new K7Document(chainText);
  editChainItemIn(doc, id, edit);
  return doc.toString();
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
    .filter((f) => isDocFile(f))
    .sort()
    .map((f) => `${CHAINS_DIR}/${f}`);
}
