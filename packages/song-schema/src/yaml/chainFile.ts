// chainFile.ts — reading and WRITING a `chains/<name>.k7x`. A rewrite puts back every unchanged item's own source and
// the comment lines above it, found by its `id`, so a graph edit moves nodes rather than retyping them. Text in, text
// out: nothing here touches the disk. See docs/chainFiles.md.

import type { K7ListNode, K7Node, K7Path } from "@studio/k7x/ast";
import { K7Document } from "@studio/k7x/document";
import { lineCol } from "@studio/k7x/parse";
import { fromJS, headerText, type PNode, printFile } from "@studio/k7x/print";
import {
  type ChainFile,
  ChainFileSchema,
  type Item,
  isCallStep,
  isLaneItem,
  itemsOf,
  NODE_ITEM_KEYS,
} from "./chainSchema";
import { k7xSyntaxIssues } from "./k7xIssues";
import { k7xSchemaIssues } from "./k7xPosition";
import type { ModuleIssue } from "./moduleFile";
import { ModuleSchema } from "./moduleSchema";

export interface ParsedChain {
  value: ChainFile | null;
  issues: ModuleIssue[];
}

/** What reads a chain file's tree: a K7Document, or a K7Scope over one. */
type TreeReader = { getNode(path: K7Path): K7Node | undefined };

/** A node item's module fields alone — what a node FILE would hold, ready for ModuleSchema. */
export function moduleOfItem(item: Item): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const k of NODE_ITEM_KEYS) delete out[k];
  return out;
}

/** Every item of a chain's data with its path in the file: the chain's own steps, then each subchain's. */
function itemSlots(chain: ChainFile): { item: Item; path: K7Path }[] {
  const lists = [
    { at: ["steps"] as K7Path, steps: chain.steps },
    ...(chain.subchains ?? []).map((sc, j) => ({
      at: ["subchains", j, "steps"] as K7Path,
      steps: sc.steps,
    })),
  ];
  const out: { item: Item; path: K7Path }[] = [];
  for (const { at, steps } of lists)
    steps.forEach((step, s) => {
      itemsOf(step).forEach((item, k) => {
        out.push({
          item,
          path: Array.isArray(step) ? [...at, s, k] : [...at, s],
        });
      });
    });
  return out;
}

/** Parse + validate one chain file's k7x text, every node item through ModuleSchema as a node file would be. */
export function parseChain(text: string): ParsedChain {
  const doc = new K7Document(text);
  const syntax = k7xSyntaxIssues(doc);
  if (syntax.length) return { value: null, issues: syntax };
  const res = ChainFileSchema.safeParse(doc.toJS());
  if (!res.success)
    return { value: null, issues: k7xSchemaIssues(doc, res.error.issues) };
  const found = itemSlots(res.data).flatMap(({ item, path }) => {
    if (isLaneItem(item)) return [];
    const m = ModuleSchema.safeParse(moduleOfItem(item));
    return m.success
      ? []
      : m.error.issues.map((i) => ({ ...i, path: [...path, ...i.path] }));
  });
  const issues = k7xSchemaIssues(doc, found);
  return issues.length ? { value: null, issues } : { value: res.data, issues };
}

/** The path of every `steps` list of a chain file — the chain's own, then each subchain's. */
export function stepSeqs(doc: TreeReader): K7Path[] {
  const out: K7Path[] = [];
  if (doc.getNode(["steps"])?.kind === "list") out.push(["steps"]);
  const subs = doc.getNode(["subchains"]);
  if (subs?.kind === "list")
    subs.items.forEach((_, j) => {
      const at = ["subchains", j, "steps"];
      if (doc.getNode(at)?.kind === "list") out.push(at);
    });
  return out;
}

/** Every item of a chain file that carries an `id`, with its path: a step's own item, or one of a parallel step's. */
export function chainItemPaths(
  doc: TreeReader,
): { id: string; path: K7Path }[] {
  const out: { id: string; path: K7Path }[] = [];
  for (const steps of stepSeqs(doc))
    (doc.getNode(steps) as K7ListNode).items.forEach((s, i) => {
      const slots: [K7Node, K7Path][] =
        s.kind === "list"
          ? s.items.map((m, k) => [m, [...steps, i, k]])
          : [[s, [...steps, i]]];
      for (const [m, path] of slots) {
        if (m.kind !== "map") continue;
        const id = m.entries.find((e) => e.key === "id")?.value;
        if (id?.kind === "scalar" && typeof id.value === "string")
          out.push({ id: id.value, path });
      }
    });
  return out;
}

/** An item as the old file wrote it: its data, its source, the `//` lines above it and the column it started at. */
interface Kept {
  value: unknown;
  source: string;
  lead: string[];
  col: number;
}

/** Every item of the previous text by id, with what a rewrite puts back when the item is unchanged. */
function keptById(old: K7Document): Map<string, Kept> {
  const out = new Map<string, Kept>();
  if (!old.contents) return out;
  for (const { id, path } of chainItemPaths(old)) {
    const node = old.getNode(path) as K7Node;
    const list = old.getNode(path.slice(0, -1)) as K7ListNode;
    const k = path[path.length - 1] as number;
    const from =
      k > 0
        ? list.items[k - 1].end
        : list.start + (list.form === "brackets" ? 1 : 0);
    // The first line of the gap is the previous token's own, its trailing comment included: only whole lines are the item's.
    const lead = old.text
      .slice(from, node.start)
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("//"))
      .map((l) => l.slice(2));
    out.set(id, {
      value: old.getIn(path),
      source: old.text.slice(node.start, node.end),
      lead,
      col: lineCol(old.text, node.start).col,
    });
  }
  return out;
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

/** The print node at a path of a fromJS tree. */
function pnodeAt(root: PNode, path: K7Path): PNode | undefined {
  let n: PNode | undefined = root;
  for (const seg of path) {
    if (n?.kind === "map") n = n.entries.find((e) => e.key === seg)?.value;
    else if (n?.kind === "list") n = n.items[seg as number];
    else return undefined;
  }
  return n;
}

/** A source moved from one column to another, its continuation lines shifted by as much. */
function reindent(source: string, from: number, to: number): string {
  if (from === to || !source.includes("\n")) return source;
  const [first, ...rest] = source.split("\n");
  const shift = (l: string) =>
    to > from
      ? l && " ".repeat(to - from) + l
      : l.replace(new RegExp(`^ {0,${from - to}}`), "");
  return [first, ...rest.map(shift)].join("\n");
}

/** One line for what reads as one: the ports, a lane item, a subchain call, one link of an end step. */
function inlineAt(path: K7Path, value: unknown): boolean {
  if (path.length === 1) return path[0] === "ports";
  if (!path.includes("steps")) return false;
  return (
    path[path.length - 2] === "to" || isLaneItem(value) || isCallStep(value)
  );
}

/** The chain's data in the file's key order, nothing written that says nothing. */
function chainData(chain: ChainFile): Record<string, unknown> {
  const top: Record<string, unknown> = {};
  if (chain.start !== undefined) top.start = chain.start;
  if (chain.ports?.length) top.ports = chain.ports;
  if (chain.bus_only) top.bus_only = true;
  if (chain.hidden) top.hidden = true;
  if (chain.input) top.input = chain.input;
  top.steps = chain.steps;
  if (chain.subchains?.length)
    top.subchains = chain.subchains.map((sc) => ({
      id: sc.id,
      steps: sc.steps,
    }));
  return top;
}

/** Write `chain` as a file's k7x text, keeping `prevText`'s header and every unchanged item's source and comments. */
export function formatChain(chain: ChainFile, prevText = ""): string {
  const old = new K7Document(prevText);
  const kept = keptById(old);
  const root = fromJS(chainData(chain), inlineAt);
  const reused: { path: K7Path; kept: Kept }[] = [];
  for (const { item, path } of itemSlots(chain)) {
    const prev = kept.get(item.id);
    if (!prev || canonical(prev.value) !== canonical(item)) continue;
    reused.push({ path, kept: prev });
    const node = pnodeAt(root, path);
    // The comments go in the print tree, so the printer gives the item a line of its own under them.
    if (node && prev.lead.length) node.lead = prev.lead;
  }
  const fresh = new K7Document(headerText(old.header) + printFile(root));
  for (const { path, kept: prev } of reused) {
    if (fresh.getSource(path) === prev.source) continue;
    const at = fresh.getNode(path) as K7Node;
    fresh.replaceSource(
      path,
      reindent(prev.source, prev.col, lineCol(fresh.text, at.start).col),
    );
    // A multi-line string moves with its indentation inside it: shifted, it would read differently, so it goes back as written.
    if (canonical(fresh.getIn(path)) !== canonical(prev.value))
      fresh.replaceSource(path, prev.source);
  }
  return fresh.toString();
}
