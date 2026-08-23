// songRef.ts — how a project NAMES a song in the médiathèque, and the two conversions that
// go with it. A leaf with no imports at all: the browser lists a set's songs and must not
// pull `node:os` in with the word (mediatekRoot.ts opens one). See docs/songsFile.md.

/** The level the médiathèque is named under — here, so a set list costs no `homedir()` (docs/names.md). */
export const MEDIATEK_REF = "@st0";

/** The prefix a SONG ref carries — the médiathèque, then the family. */
export const MEDIATEK_SONG_REF = `${MEDIATEK_REF}/songs`;

/** The STRUCTURE only, since a ref is `@st0/` + the id verbatim and spaces are legal — see docs/names.md. */
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

/** The library-relative FOLDER a song ref lives in, with its trailing slash — a song IS its folder (docs/names.md). */
export function songPathPrefix(ref: string): string {
  return `${songIdOf(ref) ?? ""}/`;
}
