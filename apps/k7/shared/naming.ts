// Naming what comes out of an export: one file per song, unique among its siblings.
// The browser names the entries of the songbook zip with this.

/** Characters no desktop accepts in a file name, plus the ones that only cause trouble. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: a control character in a file name is the point — it is what has to go
const FORBIDDEN = /[\u0000-\u001f<>:"/\\|?*]/g;

/** A file name for one song, without extension: "Artist - Title", never empty. */
export function songBase(song: { artist: string; title: string }): string {
  const parts = [song.artist, song.title]
    .map((p) => p.replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  // Windows drops a trailing dot silently, which would turn "A." into a name that is not the one shown.
  return (parts.join(" - ") || "untitled").replace(/\.+$/, "").slice(0, 120);
}

/** The same list, with `-2`, `-3`… appended so no two songs claim one entry. */
export function uniqueNames(bases: string[], extension: string): string[] {
  const seen = new Map<string, number>();
  return bases.map((base) => {
    const key = base.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `${base}${n > 1 ? `-${n}` : ""}.${extension}`;
  });
}

/** The zip's own name, dated so two exports never land on each other in ~/Downloads. */
export function archiveName(extension: string, now = new Date()): string {
  return `songbook-${extension}-${now.toISOString().slice(0, 10)}.zip`;
}
