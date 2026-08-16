// graphFile.ts — reading and EDITING graph.yaml: bypass a module, insert one into an
// arrow, remove one, rename one. The file holds SEGMENTS (who feeds whom), so every edit
// here is an edge rewire. Full rationale: docs/graphFile.md.

import {
  Document,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type YAMLSeq,
} from "yaml";
import { type GraphFile, GraphFileSchema } from "./graphSchema";
import type { ModuleIssue } from "./moduleFile";

// YAML 1.2 (so `5:1:1` stays a string) and no wrapping, keeping a node's destinations on
// ONE line — see docs/graphFile.md.
const OPTS = { version: "1.2" as const, lineWidth: 0 };
// `toString` takes only the rendering half of those (the version is a parse concern).
const OUT = { lineWidth: 0 };

export interface ParsedChains {
  value: GraphFile | null;
  issues: ModuleIssue[];
}

export function parseGraph(text: string): ParsedChains {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };

  const raw = doc.toJS() ?? {};
  // The old format, named precisely rather than reported as an unknown key: someone
  // opening a project written last month needs the migration, not a schema error.
  if (raw && typeof raw === "object" && Array.isArray(raw.chains))
    return {
      value: null,
      issues: [
        {
          path: "chains",
          message:
            "the old chain-list format — chains are now derived from `modules:` " +
            "segments. Run `l8 migrate chains <project>`.",
        },
      ],
    };

  const result = GraphFileSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const keys = (issue as { keys?: string[] }).keys;
      const path = [...issue.path, ...(keys?.length ? [keys[0]] : [])];
      issues.push({ path: path.map(String).join("."), message: issue.message });
    }
    return { value: null, issues };
  }
  return { value: result.data, issues: [] };
}

/** Every node the file names — lanes and modules alike, which is one map now. */
export function nodeNames(text: string): string[] {
  return Object.keys(parseGraph(text).value?.modules ?? {});
}

function read(text: string): { doc: Document; file: GraphFile } {
  const { value, issues } = parseGraph(text);
  if (!value)
    throw new Error(`graph.yaml: ${issues[0]?.message ?? "unreadable"}`);
  return { doc: parseDocument(text, OPTS), file: value };
}

/**
 * Does the file name this node at all?
 *
 * This was `sectionOf`, and it answered "`tracks:` or `modules:`" — a question every edit below
 * had to carry through, because writing a lane's destinations into the wrong half unwired it
 * silently. There is one map now (docs/trackModules.md), so the question is a yes/no.
 */
const hasNode = (file: GraphFile, node: string): boolean =>
  !!file.modules && node in file.modules;

/** A sequence item's text, whether the library handed back a scalar node or a bare string. */
const itemText = (item: unknown): string =>
  String((item as { value?: unknown })?.value ?? item);

/** Take `module` out of the root `bypassed` list, dropping the list itself once it empties. */
function dropFromBypassed(doc: Document, module: string): void {
  const seq = doc.get("bypassed");
  if (!isSeq(seq)) return;
  const items = (seq as YAMLSeq).items;
  for (let i = items.length - 1; i >= 0; i--)
    if (itemText(items[i]) === module) items.splice(i, 1);
  if (!items.length) doc.delete("bypassed");
}

/** A destination list as a ONE-LINE flow sequence, matching the file's own style. */
function destsNode(doc: Document, dests: string[]) {
  const node = doc.createNode(dests);
  node.flow = true;
  return node;
}

/** Set a node's destinations, creating the `modules:` map and its entry if needed. */
function setDests(doc: Document, node: string, dests: string[]): void {
  if (!isMap(doc.getIn(["modules"]))) doc.set("modules", doc.createNode({}));
  doc.setIn(["modules", node], destsNode(doc, dests));
}

/**
 * Put `module` in the graph, wired to nothing: `modules: { <module>: [] }`.
 *
 * An empty destination list is not a placeholder — it is what a PLACED module looks like. The old list format
 * had no way to say it (a chain was a path, and a module outside one simply wasn't written down), so a module
 * had to be wired at the moment it was created. Here it can exist first and be connected after, which is how a
 * graph editor is used. Already-known nodes are left alone, so this cannot unwire one by re-adding it.
 */
export function addNode(text: string, module: string): string {
  const { doc, file } = read(text);
  if (hasNode(file, module)) return text;
  setDests(doc, module, []);
  return doc.toString(OUT);
}

/**
 * Bypass (or re-enable) one module. The name joins or leaves the root `bypassed` list, and the list disappears
 * when it empties — so bypassing and un-bypassing returns the file to what it was.
 */
export function setModuleEnabled(
  text: string,
  module: string,
  enabled: boolean,
): string {
  const { doc, file } = read(text);
  if (!hasNode(file, module))
    throw new Error(`graph.yaml has no module "${module}"`);
  const listed = (file.bypassed ?? []).includes(module);
  if (enabled === !listed) return text; // already how it was asked to be

  if (enabled) {
    dropFromBypassed(doc, module);
  } else {
    const seq = doc.get("bypassed");
    if (isSeq(seq)) (seq as YAMLSeq).items.push(doc.createNode(module));
    else doc.set("bypassed", destsNode(doc, [module]));
  }
  return doc.toString(OUT);
}

/**
 * Insert `module` into the arrow from `before` to `after`: `before` now feeds the new module, and the new module
 * feeds `after`. With no `after`, it is appended to a node that feeds nothing yet.
 *
 * One arrow, one rewire — which is the whole reason the file declares segments. In the list format this had to
 * find a chain, find a position in it, and clamp the index so the module stayed ahead of the sink.
 */
export function insertBetween(
  text: string,
  before: string,
  after: string | undefined,
  module: string,
): string {
  const { doc, file } = read(text);
  if (!hasNode(file, before))
    throw new Error(`graph.yaml has no node "${before}"`);
  const dests = [...(file.modules?.[before] ?? [])];
  if (after) {
    const at = dests.indexOf(after);
    if (at < 0)
      throw new Error(
        `'${before}' does not feed '${after}' (it feeds: ${dests.join(", ") || "nothing"})`,
      );
    dests[at] = module;
  } else {
    if (dests.length)
      throw new Error(
        `'${before}' already feeds ${dests.join(", ")} — name which one to insert before`,
      );
    dests.push(module);
  }
  setDests(doc, before, dests);
  setDests(doc, module, after ? [after] : []);
  return doc.toString(OUT);
}

/**
 * Pin (or, with null, release) where `node` sits on the graph:
 * `positions: { <node>: { x: …, y: … } }`.
 *
 * Rounded to whole px — a hand-editable file has no business carrying thirteen decimals of a
 * pointer position — and written as a one-line flow map, the destination lists' own style.
 * Releasing the last pin drops the section, so a fully auto graph leaves no trace behind.
 */
export function setNodePosition(
  text: string,
  node: string,
  at: { x: number; y: number } | null,
): string {
  const { doc } = read(text);
  if (at === null) {
    dropPosition(doc, node);
    return doc.toString(OUT);
  }
  if (!isMap(doc.getIn(["positions"])))
    doc.set("positions", doc.createNode({}));
  const entry = doc.createNode({ x: Math.round(at.x), y: Math.round(at.y) });
  entry.flow = true;
  doc.setIn(["positions", node], entry);
  return doc.toString(OUT);
}

/**
 * Draw a NEW arrow from `from` to `to` — the graph editor's patch cable. Either end may carry
 * a `#port` suffix, exactly as the file spells them (docs/ports.md): the KEY carries the
 * source's port, the destination string the target's.
 *
 * `from` gains `to` in its destinations, created as a key if the file never listed it — a node
 * can appear only as somebody's destination until now. Nothing else moves: unlike
 * insertBetween, no existing arrow is required or touched, which is the difference between
 * plugging a cable and splicing into one.
 */
export function connectNodes(text: string, from: string, to: string): string {
  const { doc, file } = read(text);
  const dests = [...(file.modules?.[from] ?? [])];
  if (dests.includes(to)) throw new Error(`'${from}' already feeds '${to}'`);
  dests.push(to);
  setDests(doc, from, dests);
  return doc.toString(OUT);
}

/**
 * Take ONE arrow out: `from` stops feeding `to` — the patch cable pulled and dropped.
 *
 * The mirror of connectNodes, and nothing else moves: a source left with no destinations
 * keeps its key as `[]`, because an unwired node is still a PLACED node (see addNode) —
 * deleting a cable must not also delete the module it fed from the graph.
 */
export function disconnectNodes(
  text: string,
  from: string,
  to: string,
): string {
  const { doc, file } = read(text);
  const dests = file.modules?.[from] ?? [];
  if (!dests.includes(to))
    throw new Error(
      `'${from}' does not feed '${to}' (it feeds: ${dests.join(", ") || "nothing"})`,
    );
  setDests(
    doc,
    from,
    dests.filter((d) => d !== to),
  );
  return doc.toString(OUT);
}

/**
 * Rejoin what fed `module` to what it fed, and hand back the nodes that were repointed.
 *
 * Splicing rather than merely dropping the key is the point: a module in the middle of a run has an upstream and
 * a downstream, and cutting it out without reconnecting them would silently cut the signal — the file would still
 * parse, and the track would go quiet with nothing to point at.
 *
 * Shared by the two verbs that take a node out of the signal path, which differ only in what
 * becomes of its OWN entry afterwards. See `unlinkNode` and `removeNode`.
 */
function spliceOut(doc: Document, file: GraphFile, module: string): string[] {
  const onward = file.modules?.[module] ?? [];
  const rewired: string[] = [];
  for (const [node, dests] of Object.entries(file.modules ?? {})) {
    if (node === module || !dests.includes(module)) continue;
    // The module's own destinations take its place, deduped: two branches that both
    // rejoined through it must not leave the survivor listed twice.
    const next: string[] = [];
    for (const d of dests)
      for (const r of d === module ? onward : [d])
        if (r !== module && !next.includes(r)) next.push(r);
    setDests(doc, node, next);
    rewired.push(node);
  }
  return rewired;
}

/**
 * Take `module` out of the signal path and LEAVE IT IN THE GRAPH, wired to nothing.
 *
 * Every node is in the graph (docs/nodes.md): a node with no entry in this file is loaded and
 * drawn nowhere, so unlinking used to make one vanish from the canvas — which reads as a delete,
 * and is not one. Its cables go, its entry stays as `modules: { <node>: [] }`, and so does its
 * pin: a node that jumped to wherever the layout put it would have moved for a reason nobody
 * asked for. Its `bypassed:` flag stays too — it is still a node, and still silenced or not.
 */
export function unlinkNode(
  text: string,
  module: string,
): { text: string; rewired: string[] } {
  const { doc, file } = read(text);
  const rewired = spliceOut(doc, file, module);
  // Named as a step or only ever as somebody's destination — either way it has an entry now.
  setDests(doc, module, []);
  return { text: doc.toString(OUT), rewired };
}

/**
 * Take `module` out of the graph ENTIRELY — the entry, its bypass and its pin.
 *
 * What `node delete` writes once the node's files are gone. Nothing may name a node with no
 * file: that is precisely what stops the project loading.
 */
export function removeNode(
  text: string,
  module: string,
): { text: string; rewired: string[] } {
  const { doc, file } = read(text);
  const rewired = spliceOut(doc, file, module);
  doc.deleteIn(["modules", module]);
  dropFromBypassed(doc, module);
  // Its pin goes with it — a position for a node that is gone is a key nothing can read.
  dropPosition(doc, module);
  return { text: doc.toString(OUT), rewired };
}

/** Drop the whole `positions:` section — `graph organize`'s write: every node handed back
 *  to the layout at once, and the file left as if nobody had ever dragged a card. */
export function clearNodePositions(text: string): string {
  const { doc } = read(text);
  if (!isMap(doc.get("positions"))) return text;
  doc.delete("positions");
  return doc.toString(OUT);
}

/** Take one node's pin out of `positions:`, dropping the section once it empties — guarded,
 *  because `deleteIn` THROWS on a path through a section the file never had. */
function dropPosition(doc: Document, node: string): void {
  const map = doc.get("positions");
  if (!isMap(map)) return;
  doc.deleteIn(["positions", node]);
  if (!map.items.length) doc.delete("positions");
}

/**
 * Rename `from` to `to` everywhere — its own entry, every list that feeds it, and its bypass.
 *
 * In place, keeping its position: a module has a place in the signal path, and removing then re-adding it loses
 * that. Only the name changes; what feeds it and what it feeds are the slot, not what fills it.
 */
export function renameNode(
  text: string,
  from: string,
  to: string,
): { text: string; rewired: string[] } {
  const { doc, file } = read(text);
  const rewired: string[] = [];

  for (const [node, dests] of Object.entries(file.modules ?? {})) {
    if (!dests.includes(from)) continue;
    setDests(
      doc,
      node,
      dests.map((d) => (d === from ? to : d)),
    );
    rewired.push(node);
  }

  // The key itself, renamed IN PLACE — the scalar's value is swapped rather than the
  // entry re-added, so the module keeps its line, its position and any comment on it.
  const map = doc.get("modules");
  if (isMap(map))
    for (const item of map.items)
      if (isScalar(item.key) && item.key.value === from) {
        item.key.value = to;
        // …and drop the quoting style with it. A ref like `@engine/…` HAD to be quoted (`@`
        // is reserved); a plain name does not, and keeping the old style would leave every
        // renamed module wearing the quotes of the one it replaced.
        item.key.type = undefined;
      }

  const bypassed = doc.get("bypassed");
  if (isSeq(bypassed)) {
    const items = (bypassed as YAMLSeq).items;
    for (let i = 0; i < items.length; i++)
      if (itemText(items[i]) === from) items[i] = doc.createNode(to);
  }
  // Its pin follows the rename, in place like the modules key — the node did not move.
  const positions = doc.get("positions");
  if (isMap(positions))
    for (const item of positions.items)
      if (isScalar(item.key) && item.key.value === from) {
        item.key.value = to;
        item.key.type = undefined;
      }
  return { text: doc.toString(OUT), rewired };
}

/** A whole segments file in canonical form — what the scaffold writes and what the migration emits. */
export function formatChains(file: GraphFile, header = ""): string {
  const doc = new Document({}, OPTS);
  const entries = Object.entries(file.modules ?? {});
  if (entries.length) {
    doc.set("modules", doc.createNode({}));
    for (const [node, dests] of entries)
      doc.setIn(["modules", node], destsNode(doc, dests));
  }
  if (file.bypassed?.length) doc.set("bypassed", destsNode(doc, file.bypassed));
  return (header ? `${header}\n` : "") + doc.toString(OUT);
}
