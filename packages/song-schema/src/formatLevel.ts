// formatLevel.ts — the project FORMAT LEVEL: the level this k7 reads and writes, the level a project
// root file declares (`format(N)`, absent meaning 1), and the refusal a newer one
// meets. What a reader gets wrong: the level is read off the RAW text, before any parse, because a
// newer file may use syntax this build cannot parse. No `node:fs`. Rationale: docs/formatLevel.md.

/** The project format this k7 reads and writes: a project root above it is refused, never half-read. */
export const FORMAT_LEVEL = 2;

/** The level an event `start` written in SECONDS needs: a level-1 build refuses the number (docs/formatLevel.md). */
export const SECONDS_START_LEVEL = 2;

/** The level a picture lane as a lane node needs: a level-2 build looks for `video_tracks/` (docs/formatLevel.md). */
export const PICTURE_LANE_LEVEL = 3;

/** The project root's key that carries the level, a sibling of `project:`. */
export const FORMAT_KEY = "format";

/** The wire code a refusal carries, so a browser tells it from a schema error after a JSON hop. */
export const FORMAT_TOO_NEW = "format-too-new";

/** A project root written at a level above FORMAT_LEVEL. */
export class FormatTooNewError extends Error {
  readonly code = FORMAT_TOO_NEW;
  constructor(
    readonly fileLevel: number,
    readonly buildLevel: number = FORMAT_LEVEL,
    readonly file?: string,
  ) {
    super(
      `${file ? `${file}: ` : ""}this project was written by a newer k7 (format ${fileLevel}); this k7 reads format ${buildLevel} — update k7 to open it`,
    );
    this.name = "FormatTooNewError";
  }
}

// A top-level `format(N)` at the start of a line.
const FORMAT_LINE = /^["']?format["']?\s*\(\s*(\d+)/m;

/** The level a root file's raw text declares, or null when it declares none. */
export function formatLevelOfText(text: string): number | null {
  const m = FORMAT_LINE.exec(text);
  return m ? Number(m[1]) : null;
}

/** The 1-based line the level is declared on, or null. */
export function formatLineOf(text: string): number | null {
  const m = FORMAT_LINE.exec(text);
  return m ? text.slice(0, m.index).split("\n").length : null;
}

/** The level a parsed root declares: its `format`, absent (or not a number) meaning 1. */
export function formatLevelOf(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 1;
  const f = (value as Record<string, unknown>)[FORMAT_KEY];
  return typeof f === "number" && Number.isFinite(f) ? f : 1;
}

/** Throws FormatTooNewError when `level` is above what this build reads. */
export function checkFormatLevel(level: number | null, file?: string): void {
  if (level !== null && level > FORMAT_LEVEL)
    throw new FormatTooNewError(level, FORMAT_LEVEL, file);
}

/** Is `e` a format refusal — the class, or a plain object or Error that carries its code after a wire hop. */
export function isFormatTooNew(e: unknown): e is FormatTooNewError {
  return (
    !!e &&
    typeof e === "object" &&
    (e as { code?: unknown }).code === FORMAT_TOO_NEW
  );
}
