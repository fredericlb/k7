// argOptions.ts — a list field's options: the value a pick INSERTS, and the label the list shows
// when that value is unreadable (a node's uuid). Ranked by the better of the two, so typing what
// you read finds what is inserted. See packages/commands/docs/completions.md.

import type { Completion } from "@studio/project-shell/project";
import { fuzzyScore } from "./fuzzy";

/** One value a field offers: what is INSERTED, and what the list shows instead when that is unreadable. */
export interface ArgOption {
  value: string;
  label?: string;
}

/** A vocabulary as options — every list but the backend's labelled one is bare strings. */
export const toOptions = (vals: readonly (string | ArgOption)[]): ArgOption[] =>
  vals.map((v) => (typeof v === "string" ? { value: v } : v));

/** A field's options ranked against what was typed, on the value OR the label — a node's uuid is found by its module. */
export function rankOptions(
  options: readonly ArgOption[],
  query: string,
  limit = 30,
): ArgOption[] {
  const q = query.trim();
  if (!q) return options.slice(0, limit);
  return options
    .map((o) => ({
      o,
      score: Math.max(
        fuzzyScore(q, o.value),
        o.label ? fuzzyScore(q, o.label) : -1,
      ),
    }))
    .filter((x) => x.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.o.label ?? a.o.value).localeCompare(b.o.label ?? b.o.value),
    )
    .slice(0, limit)
    .map((x) => x.o);
}

/** A param's candidate values, ranked the same way. Empty query keeps the provider's order. */
export function rankValues(
  values: readonly string[],
  query: string,
  limit = 30,
): string[] {
  return rankOptions(toOptions(values), query, limit).map((o) => o.value);
}

/** `/complete`'s whole lines as one field's options: the prefix sent sliced back off, deduped by value, labels kept. */
export function optionsFromCompletions(
  full: readonly Completion[],
  prefix: string,
): ArgOption[] {
  const seen = new Set<string>();
  const out: ArgOption[] = [];
  for (const c of full) {
    // Sliced by the prefix and not indexed by token, which keeps a multi-word command and a spaced value whole.
    const value = c.line.startsWith(prefix) ? c.line.slice(prefix.length) : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(c.label ? { value, label: c.label } : { value });
  }
  return out;
}
