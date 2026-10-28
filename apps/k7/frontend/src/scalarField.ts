// scalarField.ts — one string field read out of a project file's text by a scan, half-typed files included.
// Apart from projectPaths.ts, which the home page imports, so the k7x parser it unquotes with loads only in the editor.

import { parseValue } from "@studio/k7x/parse";

/** A string field's value, a call's `key("v")` or an object's `key: "v"`, found by a scan so a half-typed file still answers. */
export function readScalarField(text: string, key: string): string | null {
  const m = new RegExp(
    `(?:^|[^A-Za-z0-9_$-])${key}\\s*[(:]\\s*("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')`,
  ).exec(text);
  if (!m) return null;
  try {
    const node = parseValue(m[1]);
    return node.kind === "scalar" && typeof node.value === "string"
      ? node.value || null
      : null;
  } catch {
    return null;
  }
}
