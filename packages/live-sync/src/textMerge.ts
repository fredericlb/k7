// textMerge.ts — a whole text that arrives after its file moved, merged line by line against the text it replaced.
// The room finds that base among the recent versions it keeps per file, by the hash the op names in `was`.
// A merge with any conflicting region is no merge: no conflict marker is ever written into a file. See ../docs/sync.md.

import { diff3Merge } from "node-diff3";
import { isBlobRef } from "./blob.ts";
import { textHash } from "./textHash.ts";

/** How many versions of one file the room keeps as bases, and how many characters in all. */
const VERSIONS_KEEP = 20;
const CHARS_KEEP = 1 << 20;

/** A k7x file merges by path ops, and a blob ref is no text: neither is kept or merged as lines. */
export const mergeable = (file: string, text: string | null): text is string =>
  text !== null && !/\.k7x$/i.test(file) && !isBlobRef(text);

const lines = (text: string): string[] => text.split(/(?<=\n)/);

/** `theirs` and `mine`, both made from `base`, as one text; null when they changed the same lines. */
export function mergeTexts(
  base: string,
  mine: string,
  theirs: string,
): string | null {
  const regions = diff3Merge(lines(mine), lines(base), lines(theirs), {
    excludeFalseConflicts: true,
  });
  if (regions.some((r) => r.conflict)) return null;
  return regions.flatMap((r) => r.ok ?? []).join("");
}

/** The recent versions of each mergeable file, oldest first: only what the room wrote, so a replay rebuilds it. */
export class TextBases {
  private readonly byFile = new Map<string, string[]>();

  /** Bases as `state()` saved them. */
  static from(saved: Record<string, string[]> | undefined): TextBases {
    const bases = new TextBases();
    for (const [f, v] of Object.entries(saved ?? {}))
      bases.byFile.set(f, [...v]);
    return bases;
  }

  toJSON(): Record<string, string[]> {
    return Object.fromEntries(this.byFile);
  }

  /** Follow a write: a removed or unmergeable file keeps nothing, any other text joins its versions. */
  record(file: string, text: string | null): void {
    if (!mergeable(file, text) || text.length > CHARS_KEEP) {
      this.byFile.delete(file);
      return;
    }
    const kept = this.byFile.get(file) ?? [];
    if (kept[kept.length - 1] === text) return;
    kept.push(text);
    let size = kept.reduce((n, t) => n + t.length, 0);
    while (kept.length > VERSIONS_KEEP || size > CHARS_KEEP)
      size -= kept.shift()?.length ?? 0;
    this.byFile.set(file, kept);
  }

  /** The kept version of `file` whose hash is `hash`, or null. */
  find(file: string, hash: string): string | null {
    const kept = this.byFile.get(file) ?? [];
    for (let i = kept.length - 1; i >= 0; i--)
      if (textHash(kept[i]) === hash) return kept[i];
    return null;
  }
}
