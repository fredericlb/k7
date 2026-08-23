// Domain models live in the shared workspace (single source of truth with the
// backend). Re-export them so existing `../types` imports keep working, and add
// the frontend-only UI types below.

// Selection and Metronome live in @k7/recorder; re-exported so `../types` keeps resolving.
export type { Metronome, Selection } from "@k7/recorder";
export * from "@k7/shared";

export type HomeTab =
  | "sessions"
  | "moments"
  | "releases"
  | "pages"
  | "songbook";

// The header's destinations: the home tabs, plus sections no HomeView tab backs.
export type NavKey = HomeTab | "exercices";
