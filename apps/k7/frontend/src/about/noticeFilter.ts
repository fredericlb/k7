// noticeFilter.ts — which third-party notices the About page shows for a search and a place.
// Words are ANDed, each matched against the name, the licence and the version (../../docs/about.md).

import type { NoticeEntry, Where } from "../../notices/types";

/** Every place a component ships, in the order the page offers them. */
export const WHERES: Where[] = [
  "web",
  "server",
  "engine",
  "desktop",
  "android",
];

export function filterNotices(
  entries: NoticeEntry[],
  query: string,
  where: Where | null,
): NoticeEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (where && !e.where.includes(where)) return false;
    const hay = `${e.name} ${e.license} ${e.version ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** How many components ship in each place, for the filter's labels. */
export function countByWhere(entries: NoticeEntry[]): Record<Where, number> {
  const counts = Object.fromEntries(WHERES.map((w) => [w, 0])) as Record<
    Where,
    number
  >;
  for (const e of entries) for (const w of e.where) counts[w] += 1;
  return counts;
}
