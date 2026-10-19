// projectTags.ts — a project's TAGS, `project.tags` in its project.k7x: free words a person files a song
// under, shown beside it on the home page. A tag is compared without case, so `Live` and `live` are one tag;
// the spelling kept is the first one written. No `node:`: the browser and the file service both read it.

import { parse } from "@studio/k7x/document";

/** A tag as it is stored: trimmed, inner runs of space made one, at most this long. */
const TAG_MAX = 32;

/** The tag to store for what was typed, or null when nothing is left of it. */
export function normalizeTag(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, " ").slice(0, TAG_MAX).trim();
  return t ? t : null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The list with `tag` added, unchanged when it is already there under any case. */
export function withTag(tags: readonly string[], tag: string): string[] {
  return tags.some((t) => same(t, tag)) ? [...tags] : [...tags, tag];
}

/** The list without `tag`, whatever its case. */
export function withoutTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => !same(t, tag));
}

/** The tags of a project.k7x's text; none for a file that does not parse, since a listing must not fail on one. */
export function projectTagsOf(text: string): string[] {
  try {
    const tags = (parse(text) as { project?: { tags?: unknown } }).project
      ?.tags;
    return Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === "string" && t !== "")
      : [];
  } catch {
    return [];
  }
}
