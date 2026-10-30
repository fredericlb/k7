// Domain models live in the shared workspace (single source of truth with the
// backend). Re-export them so existing `../types` imports keep working, and add
// the frontend-only UI types below.

// Selection lives in @studio/recorder; re-exported so `../types` keeps resolving.
export type { Selection } from "@studio/recorder";
export * from "@studio/rehearsal-shared";

// Where an address belongs: the host's recordings (a recording, a session, a moment), Publications, Exercises.
export type NavKey = "recordings" | "publications" | "exercises";
