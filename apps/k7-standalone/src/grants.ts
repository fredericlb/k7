// grants.ts — the permissions k7's frames get beyond the shell's defaults (docs/standalone.md, "Permissions").
// A module of its own so a test reads the app's list without starting Electron.

/** Widened past the shell's defaults for the rehearsal bench, an app frame inside an app page that records and plays MIDI. */
export const K7_GRANTS = {
  media: "app",
  midi: "app",
  "screen-wake-lock": "app",
} as const;
