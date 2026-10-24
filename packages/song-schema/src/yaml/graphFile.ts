// graphFile.ts — reading and EDITING a project's graph: bypass a module, insert one into an
// arrow, remove one, rename one. The file holds SEGMENTS (who feeds whom), so every edit
// here is an edge rewire, made on the EXPANDED data and written back through the runs short form's rule.
// Full rationale: docs/graphFile.md.

import type { K7Document, K7Scope } from "@studio/k7x/document";
import { stringify } from "@studio/k7x/print";
import { applySugared } from "@studio/k7x/sugared";
import { portRef, splitPort } from "../moduleTypes";
import { GRAPH_FILE, type GraphFile, GraphFileSchema } from "./graphSchema";
import { readK7x } from "./k7xIssues";
import { k7xPosition, k7xSchemaIssues } from "./k7xPosition";
import type { ModuleIssue } from "./moduleFile";
import { sugarFor } from "./sugar";

export interface ParsedChains {
  value: GraphFile | null;
  issues: ModuleIssue[];
}

type Data = Record<string, unknown>;
type Pos = { x: number; y: number };

/** The graph's short form, `runs([...])`, which every read expands and every write respects. */
const SUGAR = sugarFor(GRAPH_FILE);

/** The expanded data of a graph read from its document, validated, or the issues placed on its k7x lines. */
function check(doc: K7Document, raw: Data): ParsedChains {
  let data: Data;
  try {
    data = SUGAR ? SUGAR.expand(raw) : raw;
  } catch (e) {
    const at = k7xPosition(doc, ["runs"]);
    return {
      value: null,
      issues: [{ path: "runs", message: (e as Error).message, ...(at ?? {}) }],
    };
  }
  const result = GraphFileSchema.safeParse(data);
  if (!result.success)
    return { value: null, issues: k7xSchemaIssues(doc, result.error.issues) };
  return { value: result.data, issues: [] };
}

/** A graph file's k7x text as its segments, runs expanded, with every finding on its line. */
export function parseGraph(text: string): ParsedChains {
  const read = readK7x(text);
  return read.doc
    ? check(read.doc, read.data)
    : { value: null, issues: read.issues };
}

/** Every node the file names — lanes and modules alike, out of one map. */
export function nodeNames(text: string): string[] {
  return Object.keys(parseGraph(text).value?.modules ?? {});
}

/** The graph a writer edits: its expanded data, refused early rather than written over when it does not read. */
function read(doc: K7Scope): GraphFile {
  const { value, issues } = check(doc.doc, (doc.toJS() ?? {}) as Data);
  if (!value)
    throw new Error(`${GRAPH_FILE}: ${issues[0]?.message ?? "unreadable"}`);
  return value;
}

/** Write the edited expanded data back, a runs short form kept while its expansion still holds. */
function write(doc: K7Scope, after: GraphFile): void {
  if (doc.base.length === 0) applySugared(doc.doc, after, SUGAR);
  else doc.applyIn([], after);
}

/** Does the file name this node at all? One map, so the answer is a yes/no and not a section — docs/graphEdits.md. */
const hasNode = (file: GraphFile, node: string): boolean =>
  !!file.modules && node in file.modules;

/** The data with one node's destinations set, the `modules` map created when missing. */
const withDests = (
  file: GraphFile,
  node: string,
  dests: string[],
): GraphFile => ({ ...file, modules: { ...file.modules, [node]: dests } });

/** The data without `module` in the root `bypassed` list, the list itself gone once it empties. */
function withoutBypass(file: GraphFile, module: string): GraphFile {
  const { bypassed, ...rest } = file;
  const left = (bypassed ?? []).filter((m) => m !== module);
  return left.length ? { ...rest, bypassed: left } : rest;
}

/** The data without one node's pin, the section gone once it empties. */
function withoutPosition(file: GraphFile, node: string): GraphFile {
  const { positions, ...rest } = file;
  if (!positions || !(node in positions)) return file;
  const { [node]: _gone, ...left } = positions;
  return Object.keys(left).length ? { ...rest, positions: left } : rest;
}

/** Put `module` in the graph wired to nothing — an empty list is what a PLACED module looks like (docs/graphEdits.md). */
export function addNode(doc: K7Scope, module: string): void {
  const file = read(doc);
  if (hasNode(file, module)) return;
  write(doc, withDests(file, module, []));
}

/** Bypass (or re-enable) one module; the list disappears when it empties, so the round trip is a no-op. */
export function setModuleEnabled(
  doc: K7Scope,
  module: string,
  enabled: boolean,
): void {
  const file = read(doc);
  if (!hasNode(file, module))
    throw new Error(`${GRAPH_FILE} has no module "${module}"`);
  const listed = (file.bypassed ?? []).includes(module);
  if (enabled === !listed) return;
  write(
    doc,
    enabled
      ? withoutBypass(file, module)
      : { ...file, bypassed: [...(file.bypassed ?? []), module] },
  );
}

/** Insert `module` into the arrow from `before` to `after` — one arrow, one rewire (docs/graphEdits.md). */
export function insertBetween(
  doc: K7Scope,
  before: string,
  after: string | undefined,
  module: string,
): void {
  const file = read(doc);
  if (!hasNode(file, before))
    throw new Error(`${GRAPH_FILE} has no node "${before}"`);
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
  const next = withDests(file, before, dests);
  write(doc, withDests(next, module, after ? [after] : []));
}

/** Pin (or, with null, release) where `node` sits — whole px, see docs/graphEdits.md. */
export function setNodePosition(
  doc: K7Scope,
  node: string,
  at: Pos | null,
): void {
  const file = read(doc);
  if (at === null) {
    write(doc, withoutPosition(file, node));
    return;
  }
  const pin = { x: Math.round(at.x), y: Math.round(at.y) };
  write(doc, { ...file, positions: { ...file.positions, [node]: pin } });
}

/** Draw a NEW arrow from `from` to `to` — a patch cable rather than a splice, see docs/graphEdits.md. */
export function connectNodes(doc: K7Scope, from: string, to: string): void {
  const file = read(doc);
  const dests = [...(file.modules?.[from] ?? [])];
  if (dests.includes(to)) throw new Error(`'${from}' already feeds '${to}'`);
  write(doc, withDests(file, from, [...dests, to]));
}

/** Add a whole SEGMENT SET in one write — what instancing an assembly's template emits; a node already named is refused. */
export function mergeSegments(
  doc: K7Scope,
  add: {
    modules: Record<string, string[]>;
    bypassed?: string[];
    bus_only?: string[];
  },
): void {
  let file = read(doc);
  for (const node of Object.keys(add.modules))
    if (hasNode(file, node))
      throw new Error(`'${node}' is already in the graph`);
  file = { ...file, modules: { ...file.modules, ...add.modules } };
  for (const key of ["bypassed", "bus_only"] as const) {
    const names = add[key] ?? [];
    if (!names.length) continue;
    const have = new Set(file[key] ?? []);
    file = {
      ...file,
      [key]: [...(file[key] ?? []), ...names.filter((n) => !have.has(n))],
    };
  }
  write(doc, file);
}

/** Take ONE arrow out; a source left feeding nothing keeps its key as `[]` (docs/graphEdits.md). */
export function disconnectNodes(doc: K7Scope, from: string, to: string): void {
  const file = read(doc);
  const dests = file.modules?.[from] ?? [];
  if (!dests.includes(to))
    throw new Error(
      `'${from}' does not feed '${to}' (it feeds: ${dests.join(", ") || "nothing"})`,
    );
  write(
    doc,
    withDests(
      file,
      from,
      dests.filter((d) => d !== to),
    ),
  );
}

/** Rejoin what fed `module` to what it fed, handing back the data and the nodes repointed — see docs/graphEdits.md. */
function spliceOut(
  file: GraphFile,
  module: string,
): { file: GraphFile; rewired: string[] } {
  const onward = file.modules?.[module] ?? [];
  const rewired: string[] = [];
  let next = file;
  for (const [node, dests] of Object.entries(file.modules ?? {})) {
    if (node === module || !dests.includes(module)) continue;
    // The module's own destinations take its place, deduped — two branches must not list the survivor twice.
    const out: string[] = [];
    for (const d of dests)
      for (const r of d === module ? onward : [d])
        if (r !== module && !out.includes(r)) out.push(r);
    next = withDests(next, node, out);
    rewired.push(node);
  }
  return { file: next, rewired };
}

/** Take `module` out of the signal path and LEAVE IT IN THE GRAPH, wired to nothing; answers the nodes repointed. */
export function unlinkNode(doc: K7Scope, module: string): string[] {
  const { file, rewired } = spliceOut(read(doc), module);
  // Named as a step or only ever as somebody's destination — either way it has an entry now.
  write(doc, withDests(file, module, []));
  return rewired;
}

/** Take `module` out ENTIRELY — the entry, its bypass and its pin; answers the nodes repointed (docs/graphEdits.md). */
export function removeNode(doc: K7Scope, module: string): string[] {
  const { file, rewired } = spliceOut(read(doc), module);
  const { [module]: _gone, ...modules } = file.modules ?? {};
  // Its pin goes with it — a position for a node that is gone is a key nothing can read.
  write(
    doc,
    withoutPosition(withoutBypass({ ...file, modules }, module), module),
  );
  return rewired;
}

/** Pin MANY nodes in ONE write, leaving existing pins alone — see docs/graphEdits.md. */
export function setNodePositions(doc: K7Scope, at: Record<string, Pos>): void {
  const names = Object.keys(at);
  if (!names.length) return;
  const file = read(doc);
  const positions = { ...file.positions };
  for (const node of names)
    if (!(node in positions))
      positions[node] = {
        x: Math.round(at[node].x),
        y: Math.round(at[node].y),
      };
  write(doc, { ...file, positions });
}

/** Drop the whole `positions:` section — `graph organize`'s write, every node handed back to the layout. */
export function clearNodePositions(doc: K7Scope): void {
  const { positions: _gone, ...rest } = read(doc);
  write(doc, rest);
}

/** Rename `from` to `to` everywhere, IN PLACE so the node keeps its place in the file; answers the nodes repointed. */
export function renameNode(doc: K7Scope, from: string, to: string): string[] {
  const file = read(doc);
  // A ref names the node bare or through one of its ports (`gtr#L`); the port is kept, the node renamed.
  const follow = (ref: string): string => {
    const { node, port } = splitPort(ref);
    return node === from ? portRef(to, port) : ref;
  };
  const rewired = Object.entries(file.modules ?? {})
    .filter(([, dests]) => dests.some((d) => follow(d) !== d))
    .map(([node]) => node);

  // The keys first, renamed where they stand, so the entry and its comments keep their line.
  const raw = (doc.toJS() ?? {}) as Data;
  for (const section of ["modules", "positions"]) {
    const map = raw[section];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const key of Object.keys(map))
      if (follow(key) !== key) doc.renameKey([section, key], follow(key));
  }

  // Then every ref the RAW data holds, runs included: renaming the short form keeps it.
  const now = (doc.toJS() ?? {}) as Data;
  const names = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === "string" ? follow(x) : x))
      : v;
  const next: Data = { ...now };
  if (now.modules && typeof now.modules === "object")
    next.modules = Object.fromEntries(
      Object.entries(now.modules as Data).map(([k, d]) => [k, names(d)]),
    );
  if (Array.isArray(now.runs)) next.runs = now.runs.map(names);
  // …a port-qualified entry included: a picture lane's `#audio` half is bypassed by that name (song docs/videoSound.md).
  for (const list of ["bypassed", "bus_only"])
    if (Array.isArray(now[list]))
      next[list] = (now[list] as unknown[]).map((x) =>
        typeof x === "string" ? follow(x) : x,
      );
  doc.applyIn([], next);
  return rewired;
}

/** A whole segments file in canonical k7x form, `header` its `//` lines — what the scaffold writes. */
export function formatChains(
  file: GraphFile,
  header: readonly string[] = [],
): string {
  const out: Data = {};
  if (Object.keys(file.modules ?? {}).length) out.modules = file.modules;
  if (file.bypassed?.length) out.bypassed = file.bypassed;
  return stringify(out, { header });
}
