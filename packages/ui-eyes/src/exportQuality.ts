// exportQuality.ts — the quality words an export takes, apart from export.ts so the command line
// can name them without loading the muxer behind it, the heaviest thing the editor could ship.

/** The quality presets an export may ask for, lowest first; `max` is mediabunny's "very high". */
export const EXPORT_QUALITIES = ["low", "medium", "high", "max"] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];
