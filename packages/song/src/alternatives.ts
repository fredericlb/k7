// alternatives.ts — a module's other attribute SETS: which ones it has, which is on, and what
// the module looks like once that one is applied. Pure string and struct work, no filesystem,
// so a browser can ask. Full rationale: docs/alternatives.md.

import { mergeAuthored } from "./moduleResolve";
import type { LoadedModule } from "./rawDoc";

/** One entry as a surface lists it: what to call it, and where it sits. */
export interface AlternativeInfo {
  name: string;
  /** 1-based. 1 is the module's own fields, which are the first alternative. */
  at: number;
}

/**
 * Every alternative a module has, in order — the module's OWN fields first.
 *
 * That first entry is not written down anywhere: the fields at the top of the file ARE the
 * first set, and `alternatives:` holds the ones after it. It is what makes a module that never
 * uses this keep exactly the file it had, and it is why the first one cannot be named — there
 * is nowhere to carry a name. It answers to "1".
 */
export function alternativesOf(
  m: { alternatives?: unknown } | null | undefined,
): AlternativeInfo[] {
  const list = Array.isArray(m?.alternatives) ? m.alternatives : [];
  return [
    { name: "1", at: 1 },
    ...list.map((a, i) => ({
      name:
        typeof (a as { name?: unknown })?.name === "string" &&
        (a as { name: string }).name
          ? (a as { name: string }).name
          : String(i + 2),
      at: i + 2,
    })),
  ];
}

/**
 * Which one `want` names, as an index into `alternativesOf` — 0 when nothing answers to it.
 *
 * A NAME wins over a number, so an alternative somebody deliberately called `2` is the one
 * `alternative: 2` selects. A name that matches nothing falls back to the first rather than
 * silencing the module: a typo should cost you the variant, not the sound.
 */
export function pickAlternative(
  names: string[],
  want: string | number | undefined,
): number {
  if (want === undefined || want === null) return 0;
  const s = String(want);
  const byName = names.indexOf(s);
  if (byName >= 0) return byName;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= names.length ? n - 1 : 0;
}

/** Which alternative is ON, as an index into `alternativesOf`. */
export function currentAlternative(
  m: { alternatives?: unknown; alternative?: unknown } | null | undefined,
): number {
  return pickAlternative(
    alternativesOf(m).map((a) => a.name),
    m?.alternative as string | number | undefined,
  );
}

/**
 * `m` with its selected alternative merged over its own fields.
 *
 * The SAME merge an instance gets over the module it extends (`mergeAuthored`), and that is the
 * whole of what an alternative is: an ordinary extender of its own module. So `params` merge per
 * entry — an alternative that sets `Gain` leaves `Tone` alone — while a LIST is a scalar to the
 * merge, so an alternative restating `clips:` replaces the arrangement outright. Both readings
 * are the ones already true everywhere else here.
 *
 * The alternative's `name` is dropped before merging. It is in `OWN_ONLY`, so leaving it in would
 * rename the module to the name of its variant — and a module's name is the key a chain calls it
 * by, which is not a thing a setting may change.
 *
 * `alternatives`/`alternative` ride through untouched, so a surface can still list them AFTER
 * resolution: what is drawn on the node is what the file says, not what it was collapsed to.
 */
export function applyAlternative<T extends LoadedModule>(m: T): T {
  const at = currentAlternative(m);
  if (at === 0) return m;
  const list = (m.alternatives ?? []) as Record<string, unknown>[];
  const chosen = list[at - 1];
  if (!chosen) return m;
  const { name: _dropped, ...fields } = chosen;
  return mergeAuthored(
    m as unknown as Record<string, unknown>,
    fields,
  ) as unknown as T;
}
