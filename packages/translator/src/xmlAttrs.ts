// xmlAttrs.ts — reading fast-xml-parser's output, shared by the two importers: an attribute as a
// number, a boolean or a string, a child that may be one or many, a text node.
// `val` is Live's alone: it walks the <X><Manual Value="…"/></X> nesting a .als wraps every scalar in.

export const num = (v: unknown, dflt = 0): number => {
  const n =
    typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : dflt;
};
export const bool = (v: unknown): boolean => v === "true" || v === true;
export const str = (v: unknown): string | undefined =>
  v == null ? undefined : String(v);
// Trim float noise (both formats write ~17 digits) without lying about beats.
export const round = (n: number, p = 6): number => {
  const f = 10 ** p;
  return Math.round(n * f) / f;
};
export const asArray = <T>(v: T | T[] | undefined): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

// Live nests every scalar as <Volume><Manual Value="0.85"/></Volume>. One walker for all of them.
export const val = (node: any, ...path: string[]): unknown => {
  let cur = node;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) ? cur[0]?.[key] : cur[key];
  }
  return Array.isArray(cur) ? cur[0]?.["@_Value"] : cur?.["@_Value"];
};

// fast-xml-parser gives a string for a text-only node, or an object with #text when it carries attributes.
export function textOf(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  const text = (node as any)["#text"];
  return text == null ? null : String(text);
}
