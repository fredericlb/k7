// Domain models live in the shared workspace (single source of truth with the
// backend). Re-export them so existing `../types` imports keep working, and add
// the frontend-only UI types below.

// Selection and Metronome live in @k7/recorder; re-exported so `../types` keeps resolving.
export type { Metronome, Selection } from "@k7/recorder";
export * from "@k7/shared";

export type HomeTab = "sessions" | "releases" | "pages" | "songbook";

// The header's destinations: one entry per section, sessions and their moments under Recordings, releases and pages Publications.
export type NavKey = "recordings" | "publications" | "songbook" | "exercices";

/** The Supernote sync's state, as the settings screen sees it — never the password. */
export interface SupernoteSync {
  enabled: boolean;
  baseUrl: string;
  account: string;
  activated: boolean;
  lastSyncAt: string;
  lastStatus: string;
  lastCount: number;
  syncing: boolean;
}
