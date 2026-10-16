// pageVisibility.ts — who may open a page by its nametag: its owner, anyone signed in, or anyone.
// The order is the picker's, narrowest first — ../rehearsal-server/docs/pages.md.

export const PAGE_VISIBILITIES = [
  "private",
  "authenticated",
  "public",
] as const;

export type PageVisibility = (typeof PAGE_VISIBILITIES)[number];
