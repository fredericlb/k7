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
import { portRef, splitPort } from "../moduleTypes";
import { type GraphFile, GraphFileSchema } from "./graphSchema";
import type { ModuleIssue } from "./moduleFile";

// YAML 1.2 (so `5:1:1` stays a string) and no wrapping, keeping destinations on ONE line (docs/graphEdits.md).
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
  // A `chains:` list is named precisely rather than reported as an unknown key — see docs/graphEdits.md.
  if (raw && typeof raw === "object" && Array.isArray(raw.chains))
    return {
      value: null,
      issues: [
        {
          path: "chains",
          message:
            "the old chain-list format — chains are now derived from `modules:` " +
            "segments. Run `k7 migrate chains <project>`.",
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

/** Every node the file names — lanes and modules alike, out of one map. */
export function nodeNames(text: string): string[] {
  return Object.keys(parseGraph(text).value?.modules ?? {});
}

function read(text: string): { doc: Document; file: GraphFile } {
  const { value, issues } = parseGraph(text);
  if (!value)
    throw new Error(`graph.yaml: ${issues[0]?.message ?? "unreadable"}`);
  return { doc: parseDocument(text, OPTS), file: value };
}

/** Does the file name this node at all? One map, so the answer is a yes/no and not a section — docs/graphEdits.md. */
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

/** Put `module` in the graph wired to nothing — an empty list is what a PLACED module looks like (docs/graphEdits.md). */
export function addNode(text: string, module: string): string {
  const { doc, file } = read(text);
  if (hasNode(file, module)) return text;
  setDests(doc, module, []);
  return doc.toString(OUT);
}

/** Bypass (or re-enable) one module; the list disappears when it empties, so the round trip is a no-op. */
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

/** Insert `module` into the arrow from `before` to `after` — one arrow, one rewire (docs/graphEdits.md). */
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

/** Pin (or, with null, release) where `node` sits — whole px, one-line flow map, see docs/graphEdits.md. */
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

/** Draw a NEW arrow from `from` to `to` — a patch cable rather than a splice, see docs/graphEdits.md. */
export function connectNodes(text: string, from: string, to: string): string {
  const { doc, file } = read(text);
  const dests = [...(file.modules?.[from] ?? [])];
  if (dests.includes(to)) throw new Error(`'${from}' already feeds '${to}'`);
  dests.push(to);
  setDests(doc, from, dests);
  return doc.toString(OUT);
}

/** Add a whole SEGMENT SET in one write — what instancing an assembly's template emits.
 *
 * One write rather than a `connectNodes` per edge: a turntable is eighteen nodes and twenty arrows,
 * and a parse-and-serialise apiece would put twenty diffs' worth of reflow risk on one gesture.
 * A node the file already names is refused, since the flat key space is the whole model here. */
export function mergeSegments(
  text: string,
  add: {
    modules: Record<string, string[]>;
    bypassed?: string[];
    bus_only?: string[];
  },
): string {
  const { doc, file } = read(text);
  for (const node of Object.keys(add.modules))
    if (hasNode(file, node))
      throw new Error(`'${node}' is already in the graph`);
  for (const [node, dests] of Object.entries(add.modules))
    setDests(doc, node, dests);
  for (const key of ["bypassed", "bus_only"] as const) {
    const names = add[key] ?? [];
    if (!names.length) continue;
    const have = new Set(file[key] ?? []);
    const next = [...(file[key] ?? []), ...names.filter((n) => !have.has(n))];
    doc.set(key, destsNode(doc, next));
  }
  return doc.toString(OUT);
}

/** Take ONE arrow out; a source left feeding nothing keeps its key as `[]` (docs/graphEdits.md). */
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

/** Rejoin what fed `module` to what it fed, handing back the nodes repointed — see docs/graphEdits.md. */
function spliceOut(doc: Document, file: GraphFile, module: string): string[] {
  const onward = file.modules?.[module] ?? [];
  const rewired: string[] = [];
  for (const [node, dests] of Object.entries(file.modules ?? {})) {
    if (node === module || !dests.includes(module)) continue;
    // The module's own destinations take its place, deduped — two branches must not list the survivor twice.
    const next: string[] = [];
    for (const d of dests)
      for (const r of d === module ? onward : [d])
        if (r !== module && !next.includes(r)) next.push(r);
    setDests(doc, node, next);
    rewired.push(node);
  }
  return rewired;
}

/** Take `module` out of the signal path and LEAVE IT IN THE GRAPH, wired to nothing — docs/graphEdits.md. */
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

/** Take `module` out ENTIRELY — the entry, its bypass and its pin; what `node delete` writes (docs/graphEdits.md). */
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

/** Pin MANY nodes in ONE write, leaving existing pins alone — see docs/graphEdits.md. */
export function setNodePositions(
  text: string,
  at: Record<string, { x: number; y: number }>,
): string {
  const names = Object.keys(at);
  if (!names.length) return text;
  const { doc } = read(text);
  if (!isMap(doc.getIn(["positions"])))
    doc.set("positions", doc.createNode({}));
  let wrote = false;
  for (const node of names) {
    if (doc.getIn(["positions", node]) !== undefined) continue; // already somebody's answer
    const entry = doc.createNode({
      x: Math.round(at[node].x),
      y: Math.round(at[node].y),
    });
    entry.flow = true;
    doc.setIn(["positions", node], entry);
    wrote = true;
  }
  return wrote ? doc.toString(OUT) : text;
}

/** Drop the whole `positions:` section — `graph organize`'s write, every node handed back to the layout. */
export function clearNodePositions(text: string): string {
  const { doc } = read(text);
  if (!isMap(doc.get("positions"))) return text;
  doc.delete("positions");
  return doc.toString(OUT);
}

/** Take one node's pin out, dropping the section once it empties — guarded, since `deleteIn` THROWS on a missing path. */
function dropPosition(doc: Document, node: string): void {
  const map = doc.get("positions");
  if (!isMap(map)) return;
  doc.deleteIn(["positions", node]);
  if (!map.items.length) doc.delete("positions");
}

/** Rename `from` to `to` everywhere, IN PLACE so the module keeps its place in the file (docs/graphEdits.md). */
export function renameNode(
  text: string,
  from: string,
  to: string,
): { text: string; rewired: string[] } {
  const { doc, file } = read(text);
  const rewired: string[] = [];
  // A ref names the node bare or through one of its ports (`gtr#L`); the port is kept, the node renamed.
  const follow = (ref: string): string => {
    const { node, port } = splitPort(ref);
    return node === from ? portRef(to, port) : ref;
  };

  for (const [node, dests] of Object.entries(file.modules ?? {})) {
    if (!dests.some((d) => follow(d) !== d)) continue;
    setDests(doc, node, dests.map(follow));
    rewired.push(node);
  }

  // The key itself, renamed IN PLACE: the scalar's value is swapped rather than the entry re-added.
  const map = doc.get("modules");
  if (isMap(map))
    for (const item of map.items)
      if (
        isScalar(item.key) &&
        typeof item.key.value === "string" &&
        follow(item.key.value) !== item.key.value
      ) {
        item.key.value = follow(item.key.value);
        // …and drop the quoting style with it, or a renamed module wears the quotes of the one it replaced.
        item.key.type = undefined;
      }

  for (const list of ["bypassed", "bus_only"]) {
    const seq = doc.get(list);
    if (!isSeq(seq)) continue;
    const items = (seq as YAMLSeq).items;
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
