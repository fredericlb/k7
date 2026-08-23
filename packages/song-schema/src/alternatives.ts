// alternatives.ts — a module's other attribute SETS: which ones it has, and which is on.
// Pure string and struct work, no filesystem and no module system, so a browser and the YAML
// readers beside it can ask. APPLYING one is @studio/song's, because the merge it uses is the
// one a node gets over the module it extends. Full rationale: packages/song/docs/alternatives.md.

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
