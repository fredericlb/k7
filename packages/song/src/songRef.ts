// songRef.ts — how a project NAMES a song in the médiathèque, and the two conversions that
// go with it. A leaf with no imports at all: the browser lists a set's songs and must not
// pull `node:os` in with the word (mediatekRoot.ts opens one). See docs/songsFile.md.

/**
 * The level the médiathèque is named under — `@mediatek/…`.
 *
 * Here rather than in mediatekRoot.ts, which owns the rest of the library's layout: that file
 * reads `homedir()`, and this token is needed by every surface that draws a set list. Same
 * reason `CHAINS_FILE` sits in @studio/mediatek's types.ts and not in its scan. mediatekRoot
 * re-exports it, so nothing that already imports it from there had to change.
 */
export const MEDIATEK_REF = "@mediatek";

/** The prefix a SONG ref carries — the médiathèque, then the family. */
export const MEDIATEK_SONG_REF = `${MEDIATEK_REF}/songs`;

/**
 * A song ref is `@mediatek/` + the médiathèque id, VERBATIM.
 *
 * A `MediatekEntry.id` is the entry's library-relative POSIX path (`songs/artist/album/title`)
 * and the catalogue's own note says nothing else survives a rescan. A ref that IS the id
 * therefore needs nothing resolved to be compared, deduplicated or fetched — the resolution
 * is a lookup, not a computation, and a ref that resolves to nothing is still a well-formed
 * name for the thing to go and fetch.
 *
 * A MODULE ref omits its family (`@mediatek/audio/reverb` means `modules/audio/reverb`)
 * because that vocabulary predates the médiathèque having families. The two are not made
 * consistent here: rewriting every song already written would cost more than the asymmetry,
 * and the two are read by different files, so nothing has to tell them apart at a distance.
 */
/**
 * The shape only: `@mediatek/songs/` then at least one non-empty segment.
 *
 * **Spaces are legal, and that is not a detail.** A médiathèque id is built from the tags —
 * `songs/Alain Bashung/Album inconnu/La nuit je mens` is a real one — so a pattern that
 * banned whitespace refused nearly every set list anyone would actually write. This one is
 * strict about STRUCTURE (no empty segment, no trailing slash, one line) and says nothing
 * about the characters a segment may hold, because the médiathèque is what decides those and
 * a ref is compared to its id verbatim.
 */
export const SONG_REF = new RegExp(
  `^${MEDIATEK_SONG_REF}/(?:[^/\\r\\n]+/)*[^/\\r\\n]+$`,
);

/** True for a well-formed song ref — the shape, never whether the médiathèque has it. */
export const isSongRef = (v: unknown): v is string =>
  typeof v === "string" && SONG_REF.test(v);

/** The médiathèque id a ref names (`songs/artist/album/title`), or null when it isn't one. */
export function songIdOf(ref: unknown): string | null {
  return isSongRef(ref) ? ref.slice(MEDIATEK_REF.length + 1) : null;
}

/** The ref for a médiathèque id — the inverse, for a surface that writes songs.yaml. */
export function songRefOf(id: string): string {
  return `${MEDIATEK_REF}/${id.replace(/^\/+|\/+$/g, "")}`;
}

/**
 * The library-relative folder a song ref lives in, with its trailing slash — what a cache
 * sync fetches. A prefix rather than the sidecar's path because a song IS its folder: the
 * master, its variants and `song.yaml` are all of it, and a sync that fetched only the file
 * named would land a catalogued folder with nothing to play. Same rule, and the same reason,
 * as `mediatekPathPrefix` for a module.
 */
export function songPathPrefix(ref: string): string {
  return `${songIdOf(ref) ?? ""}/`;
}
