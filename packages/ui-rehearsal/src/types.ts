// Domain models live in the shared workspace (single source of truth with the
// backend). Re-export them so existing `../types` imports keep working, and add
// the frontend-only UI types below.

// Selection and Metronome live in @studio/recorder; re-exported so `../types` keeps resolving.
export type { Metronome, Selection } from "@studio/recorder";
export * from "@studio/rehearsal-shared";

export type HomeTab = "sessions" | "releases" | "songbook";

// The header's destinations: one entry per section, sessions and their moments under Recordings, releases and pages Publications.
export type NavKey = "recordings" | "publications" | "songbook" | "exercices";
