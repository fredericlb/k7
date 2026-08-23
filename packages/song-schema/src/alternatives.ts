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

/** Every alternative a module has, the module's OWN fields first and answering to "1" (docs/alternatives.md). */
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

/** Which one `want` names, a NAME winning over a number and a miss falling back to the first, never to silence. */
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
