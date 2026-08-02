// Domain models live in the shared workspace (single source of truth with the
// backend). Re-export them so existing `../types` imports keep working, and add
// the frontend-only UI types below.

// Selection and Metronome now live in the @radiok7/recorder package; re-export them
// (type-only) so existing `../types` imports keep resolving.
export type { Metronome, Selection } from "@radiok7/recorder";
export * from "@radiok7/shared";

export type HomeTab =
  | "sessions"
  | "moments"
  | "releases"
  | "pages"
  | "songbook";

// Top-level header nav destinations: the home tabs plus standalone sections
// (like Exercices) that aren't backed by a HomeView tab.
export type NavKey = HomeTab | "exercices";
