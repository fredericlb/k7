// chainsFile.ts — reading and EDITING chains.yaml: bypass a module, insert one into an
// arrow, remove one, rename one. The file holds SEGMENTS (who feeds whom), so every edit
// here is an edge rewire. Full rationale: docs/chainsFile.md.

import {
  Document,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type YAMLSeq,
} from "yaml";
import { type ChainsFile, ChainsFileSchema } from "./chainsSchema";
import type { ModuleIssue } from "./moduleFile";

// YAML 1.2 (so `5:1:1` stays a string) and no wrapping, keeping a node's destinations on
// ONE line — see docs/chainsFile.md.
const OPTS = { version: "1.2" as const, lineWidth: 0 };
// `toString` takes only the rendering half of those (the version is a parse concern).
const OUT = { lineWidth: 0 };

export interface ParsedChains {
  value: ChainsFile | null;
  issues: ModuleIssue[];
}

export function parseChains(text: string): ParsedChains {
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
            "the old chain-list format — chains are now derived from `tracks:`/`modules:` " +
            "segments. Run `lanes migrate chains <project>`.",
        },
      ],
    };

  const result = ChainsFileSchema.safeParse(raw);
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

/** Every node the file names, tracks and modules alike — the vocabulary an edit may refer to. */
export function nodeNames(text: string): string[] {
  const f = parseChains(text).value;
  return [...Object.keys(f?.tracks ?? {}), ...Object.keys(f?.modules ?? {})];
}

function read(text: string): { doc: Document; file: ChainsFile } {
  const { value, issues } = parseChains(text);
  if (!value)
    throw new Error(`chains.yaml: ${issues[0]?.message ?? "unreadable"}`);
  return { doc: parseDocument(text, OPTS), file: value };
}

/** Where a node's destinations live — `tracks` for a track, `modules` for anything else. Undefined when the file doesn't name it. */
function sectionOf(
  file: ChainsFile,
  node: string,
): "tracks" | "modules" | null {
  if (file.tracks && node in file.tracks) return "tracks";
  if (file.modules && node in file.modules) return "modules";
  return null;
}

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

/** Set a node's destinations, creating its section and its entry if needed. */
function setDests(
  doc: Document,
  section: "tracks" | "modules",
  node: string,
  dests: string[],
): void {
  if (!isMap(doc.getIn([section]))) doc.set(section, doc.createNode({}));
  doc.setIn([section, node], destsNode(doc, dests));
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
  if (sectionOf(file, module)) return text;
  setDests(doc, "modules", module, []);
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
  if (!sectionOf(file, module))
    throw new Error(`chains.yaml has no module "${module}"`);
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
  const section = sectionOf(file, before);
  if (!section) throw new Error(`chains.yaml has no node "${before}"`);
  const dests = [...(file[section]?.[before] ?? [])];
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
  setDests(doc, section, before, dests);
  setDests(doc, "modules", module, after ? [after] : []);
  return doc.toString(OUT);
}

/**
 * Remove `module` from the graph, joining what fed it to what it fed.
 *
 * Splicing rather than merely deleting the key is the point: a module in the middle of a run has an upstream and
 * a downstream, and dropping it without reconnecting them would silently cut the signal — the file would still
 * parse, and the track would go quiet with nothing to point at. Returns the nodes that were repointed.
 */
export function removeNode(
  text: string,
  module: string,
): { text: string; rewired: string[] } {
  const { doc, file } = read(text);
  const onward = file.modules?.[module] ?? [];
  const rewired: string[] = [];

  for (const section of ["tracks", "modules"] as const)
    for (const [node, dests] of Object.entries(file[section] ?? {})) {
      if (node === module || !dests.includes(module)) continue;
      // The module's own destinations take its place, deduped: two branches that both
      // rejoined through it must not leave the survivor listed twice.
      const next: string[] = [];
      for (const d of dests)
        for (const r of d === module ? onward : [d])
          if (r !== module && !next.includes(r)) next.push(r);
      setDests(doc, section, node, next);
      rewired.push(node);
    }

  doc.deleteIn(["modules", module]);
  dropFromBypassed(doc, module);
  return { text: doc.toString(OUT), rewired };
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

  for (const section of ["tracks", "modules"] as const)
    for (const [node, dests] of Object.entries(file[section] ?? {})) {
      if (!dests.includes(from)) continue;
      setDests(
        doc,
        section,
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
  return { text: doc.toString(OUT), rewired };
}

/** A whole segments file in canonical form — what the scaffold writes and what the migration emits. */
export function formatChains(file: ChainsFile, header = ""): string {
  const doc = new Document({}, OPTS);
  for (const section of ["tracks", "modules"] as const) {
    const entries = Object.entries(file[section] ?? {});
    if (!entries.length) continue;
    doc.set(section, doc.createNode({}));
    for (const [node, dests] of entries)
      doc.setIn([section, node], destsNode(doc, dests));
  }
  if (file.bypassed?.length) doc.set("bypassed", destsNode(doc, file.bypassed));
  return (header ? `${header}\n` : "") + doc.toString(OUT);
}
