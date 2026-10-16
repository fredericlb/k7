// print.ts — a value (with the comments a conversion carries) → k7x text, in the one canonical layout.
// Canonical only for text written whole: an edit prints just the value it changes and keeps every other byte (edit.ts).

import type { K7Scalar } from "./ast.ts";

/** A value to print, with the comment lines that sit before it, after it, and inside it before its closing bracket. */
export type PNode = (
  | { kind: "scalar"; value: K7Scalar }
  | { kind: "list"; items: PNode[] }
  | { kind: "map"; entries: PEntry[] }
) & {
  lead?: string[];
  after?: string[];
  end?: string[];
  blank?: boolean;
  /** Written on one line by its author: kept on one line whatever its width, so a conversion keeps their layout. */
  inline?: boolean;
};

export interface PEntry {
  key: string;
  value: PNode;
  lead?: string[];
  blank?: boolean;
}

/** Where a value sits: an entry's value prints a map as `{…}`, a list item as a chain, a call's lone argument list bare. */
export type Ctx = "entry" | "item" | "args";

const WIDTH = 100;
const IDENT_KEY = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

export const printKey = (key: string): string =>
  IDENT_KEY.test(key) ? key : JSON.stringify(key);

function printScalar(value: K7Scalar): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`k7x has no ${value}`);
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "string" && value.includes("\n"))
    return `\`${value.replace(/[\\`]/g, (c) => `\\${c}`)}\``;
  return JSON.stringify(value);
}

export function fromJS(value: unknown): PNode {
  if (Array.isArray(value)) return { kind: "list", items: value.map(fromJS) };
  if (value !== null && typeof value === "object")
    return {
      kind: "map",
      entries: Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([key, v]) => ({ key, value: fromJS(v) })),
    };
  if (value === undefined) return { kind: "scalar", value: null };
  return { kind: "scalar", value: value as K7Scalar };
}

const hasComments = (n: PNode): boolean =>
  !!(n.lead?.length || n.after?.length || n.end?.length) ||
  (n.kind === "list" && n.items.some(hasComments)) ||
  (n.kind === "map" &&
    n.entries.some((e) => !!e.lead?.length || hasComments(e.value)));

const asChain = (n: PNode, ctx: Ctx): boolean =>
  n.kind === "map" &&
  ctx === "item" &&
  n.entries.length > 0 &&
  !n.end?.length &&
  n.entries.every((e) => IDENT_KEY.test(e.key));

/** One-line text for a node with no comments in it, else null. */
function flat(n: PNode, ctx: Ctx): string | null {
  if (hasComments(n)) return null;
  if (n.kind === "scalar") return printScalar(n.value);
  if (n.kind === "list") {
    const items = n.items.map((i) => flat(i, "item"));
    return ctx === "args" ? items.join(", ") : `[${items.join(", ")}]`;
  }
  if (asChain(n, ctx))
    return n.entries
      .map((e) => `${printKey(e.key)}(${flat(e.value, "entry")})`)
      .join(".");
  if (n.entries.length === 0) return "{}";
  return `{ ${n.entries.map((e) => `${printKey(e.key)}: ${flat(e.value, "entry")}`).join(", ")} }`;
}

const pad = (n: number): string => " ".repeat(n);
const comment = (text: string, indent: number): string =>
  text === "" ? "" : `${pad(indent)}//${text}`.trimEnd();

/** A node's text, plus the comment lines it hands its container to place around its separator. */
interface Out {
  text: string;
  lead: string[];
  after: string[];
}

/** `indent` is the indentation of the line the node starts on; `used` is how many columns precede it there. */
export function print(n: PNode, indent: number, ctx: Ctx, used: number): Out {
  const lead = n.lead ?? [];
  const after = n.after ?? [];
  const one = flat({ ...n, lead: [], after: [] }, ctx);
  if (
    one !== null &&
    !one.includes("\n") &&
    (n.inline || used + one.length <= WIDTH)
  )
    return { text: one, lead, after };
  if (one !== null && n.kind === "scalar") return { text: one, lead, after };
  if (ctx === "args") return print(n, indent, "entry", used);
  if (asChain(n, ctx))
    return chain(
      n as Extract<PNode, { kind: "map" }>,
      indent,
      used,
      lead,
      after,
    );
  const inner = indent + 2;
  const lines: string[] = [];
  const push = (o: Out, head: string, blank?: boolean) => {
    if (blank && lines.length > 0) lines.push("");
    for (const c of o.lead) lines.push(comment(c, inner));
    const [first, ...rest] = o.after;
    lines.push(
      `${pad(inner)}${head}${o.text},${first === undefined ? "" : ` //${first}`.trimEnd()}`,
    );
    for (const c of rest) lines.push(comment(c, inner));
  };
  if (n.kind === "list") {
    for (const item of n.items)
      push(print(item, inner, "item", inner), "", item.blank);
  } else if (n.kind === "map") {
    for (const e of n.entries) {
      const head = `${printKey(e.key)}: `;
      const o = print(e.value, inner, "entry", inner + head.length);
      push({ ...o, lead: [...(e.lead ?? []), ...o.lead] }, head, e.blank);
    }
  }
  for (const c of n.end ?? []) lines.push(comment(c, inner));
  const [open, close] = n.kind === "list" ? ["[", "]"] : ["{", "}"];
  return {
    text: `${open}\n${lines.join("\n")}\n${pad(indent)}${close}`,
    lead,
    after,
  };
}

function chain(
  n: Extract<PNode, { kind: "map" }>,
  indent: number,
  used: number,
  lead: string[],
  after: string[],
): Out {
  const cont = indent + 2;
  const parts: string[] = [];
  let pending: string[] = [];
  n.entries.forEach((e, i) => {
    const head = `${i === 0 ? "" : "."}${printKey(e.key)}(`;
    const at = i === 0 ? used : cont;
    const o = print(
      e.value,
      i === 0 ? indent : cont,
      "entry",
      at + head.length,
    );
    const entryLead = [...(e.lead ?? []), ...o.lead];
    if (i === 0) lead = [...lead, ...entryLead];
    let text = `${head}${o.text})`;
    if (i > 0) {
      const above = [...pending, ...entryLead]
        .map((c) => `${comment(c, cont)}\n`)
        .join("");
      text = `\n${above}${pad(cont)}${text}`;
    }
    parts.push(text);
    pending = [];
    const [first, ...rest] = o.after;
    if (first !== undefined && i < n.entries.length - 1) {
      parts.push(` //${first}`.trimEnd());
      pending = rest;
    } else if (first !== undefined) after = [...o.after, ...after];
  });
  return { text: parts.join(""), lead, after };
}

/** A whole file: the root map's entries as one statement per line, with the file's own top and bottom comments. */
export function printFile(
  root: PNode,
  top: string[] = [],
  bottom: string[] = [],
): string {
  if (root.kind !== "map") throw new Error("a k7x file is a map at its root");
  const lines: string[] = top.map((c) => comment(c, 0));
  for (const e of root.entries) {
    if (
      (e.blank || e.value.blank) &&
      lines.length > 0 &&
      lines[lines.length - 1] !== ""
    )
      lines.push("");
    const head = `${printKey(e.key)}(`;
    const o = print(e.value, 0, "entry", head.length);
    for (const c of [...(e.lead ?? []), ...o.lead]) lines.push(comment(c, 0));
    const [first, ...rest] = o.after;
    lines.push(
      `${head}${o.text})${first === undefined ? "" : ` //${first}`.trimEnd()}`,
    );
    for (const c of rest) lines.push(comment(c, 0));
  }
  for (const c of [...(root.end ?? []), ...bottom]) lines.push(comment(c, 0));
  return `${lines.join("\n")}\n`;
}

/** Canonical text for a plain object, with no comments. */
export function stringify(value: unknown): string {
  return printFile(fromJS(value));
}
