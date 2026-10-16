// chainFile.ts — reading and WRITING a `chains/<name>.yaml`. A rewrite keeps every existing item's
// own YAML node (comments included) by its `id`, so a graph edit moves nodes rather than retyping
// them. Text in, text out: nothing here touches the disk. See docs/chainFiles.md.

import {
  type Document,
  isMap,
  isSeq,
  LineCounter,
  parseDocument,
  type YAMLMap,
  YAMLSeq,
} from "yaml";
import {
  type ChainFile,
  ChainFileSchema,
  type Item,
  isCallStep,
  isEndStep,
  isLaneItem,
  itemsOf,
  NODE_ITEM_KEYS,
  type Step,
} from "./chainSchema";
import { locate, type ModuleIssue, quoteTimecodes } from "./moduleFile";
import { ModuleSchema } from "./moduleSchema";

const OPTS = { version: "1.2" as const, strict: false };
const OUT = { lineWidth: 0 };

export interface ParsedChain {
  value: ChainFile | null;
  issues: ModuleIssue[];
}

/** A node item's module fields alone — what a node FILE would hold, ready for ModuleSchema. */
export function moduleOfItem(item: Item): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const k of NODE_ITEM_KEYS) delete out[k];
  return out;
}

/** Parse + validate one chain file, every node item through ModuleSchema as a node file would be. */
export function parseChain(text: string): ParsedChain {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };
  const raw = doc.toJS({ maxAliasCount: 100 }) ?? {};
  const res = ChainFileSchema.safeParse(raw);
  if (!res.success) {
    for (const i of res.error.issues)
      issues.push({
        path: i.path.map(String).join("."),
        message: i.message,
        ...locate(doc, lines, i.path as (string | number)[]),
      });
    return { value: null, issues };
  }
  const lists = (res.data.subchains ?? []).map((sc, j) => ({
    at: ["subchains", j, "steps"] as (string | number)[],
    steps: sc.steps,
  }));
  for (const { at: base, steps } of [
    { at: ["steps"], steps: res.data.steps },
    ...lists,
  ])
    steps.forEach((step, s) => {
      const items = itemsOf(step);
      items.forEach((item, k) => {
        if (isLaneItem(item)) return;
        const at: (string | number)[] = Array.isArray(step)
          ? [...base, s, k]
          : [...base, s];
        const m = ModuleSchema.safeParse(moduleOfItem(item));
        if (!m.success)
          for (const i of m.error.issues)
            issues.push({
              path: [...at, ...i.path].map(String).join("."),
              message: i.message,
              ...locate(doc, lines, at),
            });
      });
    });
  return issues.length ? { value: null, issues } : { value: res.data, issues };
}

/** Every item's existing YAML node in `text`, by id — what a rewrite puts back rather than retyping. */
function nodesById(doc: Document): Map<string, YAMLMap> {
  const out = new Map<string, YAMLMap>();
  for (const steps of stepSeqs(doc))
    for (const s of steps.items) {
      const maps = isSeq(s) ? s.items : [s];
      for (const m of maps)
        if (isMap(m)) {
          const id = m.get("id");
          if (typeof id === "string") out.set(id, m as YAMLMap);
        }
    }
  return out;
}

/** Every `steps:` sequence of a chain file's document — the chain's own, then each subchain's. */
export function stepSeqs(doc: Document): YAMLSeq[] {
  const out: YAMLSeq[] = [];
  const own = doc.get("steps", true);
  if (isSeq(own)) out.push(own);
  const subs = doc.get("subchains", true);
  if (isSeq(subs))
    for (const sc of subs.items)
      if (isMap(sc)) {
        const steps = sc.get("steps", true);
        if (isSeq(steps)) out.push(steps);
      }
  return out;
}

/** The node for one item: the one already in the file when the item is UNCHANGED, else a fresh one. */
function itemNode(
  doc: Document,
  item: Item,
  old: Map<string, YAMLMap>,
): unknown {
  const prev = old.get(item.id);
  if (prev && sameValue(prev.toJSON(), item)) return prev;
  const fresh = doc.createNode(item) as YAMLMap;
  // A lane item is two keys: one line reads better than three.
  if (isLaneItem(item)) fresh.flow = true;
  if (prev?.commentBefore) fresh.commentBefore = prev.commentBefore;
  return fresh;
}

function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/** JSON with every map's keys sorted — a parse may hand the same item back in another key order. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([p], [q]) => p.localeCompare(q)),
        )
      : x,
  );
}

/** Write `chain` as a file's text, keeping `prevText`'s header and every unchanged item's own node. */
export function formatChain(chain: ChainFile, prevText = ""): string {
  const doc = parseDocument(prevText || "{}", OPTS);
  const old = nodesById(doc);
  const top: Record<string, unknown> = {};
  if (chain.start !== undefined) top.start = chain.start;
  if (chain.ports?.length) top.ports = chain.ports;
  if (chain.bus_only) top.bus_only = true;
  if (chain.hidden) top.hidden = true;
  const fresh = parseDocument("start: x", OPTS);
  fresh.delete("start");
  fresh.commentBefore = doc.commentBefore;
  for (const [k, v] of Object.entries(top)) {
    const n = fresh.createNode(v);
    if (isSeq(n)) n.flow = true;
    fresh.set(k, n);
  }
  fresh.set("steps", stepsNode(fresh, chain.steps, old));
  if (chain.subchains?.length) {
    const subs = new YAMLSeq();
    for (const sc of chain.subchains) {
      const m = fresh.createNode({ id: sc.id }) as YAMLMap;
      m.set("steps", stepsNode(fresh, sc.steps, old));
      subs.items.push(m);
    }
    fresh.set("subchains", subs);
  }
  quoteTimecodes(fresh);
  return fresh.toString(OUT);
}

/** One list of steps as a YAML sequence, each unchanged item keeping its own node. */
function stepsNode(
  fresh: Document,
  list: Step[],
  old: Map<string, YAMLMap>,
): YAMLSeq {
  const steps = new YAMLSeq();
  for (const step of list) {
    if (isEndStep(step)) {
      const n = fresh.createNode(step) as YAMLMap;
      const to = n.get("to", true);
      if (isSeq(to)) for (const l of to.items) if (isMap(l)) l.flow = true;
      steps.items.push(n);
    } else if (isCallStep(step)) {
      const n = fresh.createNode(step) as YAMLMap;
      n.flow = true;
      steps.items.push(n);
    } else if (Array.isArray(step)) {
      const par = new YAMLSeq();
      for (const item of step) par.items.push(itemNode(fresh, item, old));
      steps.items.push(par);
    } else steps.items.push(itemNode(fresh, step as Item, old));
  }
  return steps;
}
