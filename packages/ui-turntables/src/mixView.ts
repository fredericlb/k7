// mixView.ts — reading the project's `views/mix.yaml`. Its own file because the desk and the
// hook that owns the decks both need it, and neither should have to import the other.

// The shared file routes, direct. m9 reached them through its own `api.ts`, which was one line
// re-exporting exactly this — "m9 is l8 without the timeline, not a second dialect of the same
// file service". With the desk in a package there is no app to go through, and the indirection
// would have been a seam over something that was already shared.
import { projectApi as api } from "@studio/project-shell/project";
import { playlistPathOf } from "@studio/song/playlist";
import {
  MIX_VIEW_BASE,
  parseMixView,
  VIEWS_DIR,
} from "@studio/song/yaml/mixViewFile";
import type { MixView } from "@studio/song/yaml/mixViewSchema";

/** The bindings file, project-relative. Named once — the name is @studio/song's. */
export const MIX_VIEW_FILE = `${VIEWS_DIR}/${MIX_VIEW_BASE}.yaml`;

/**
 * Read the desk's bindings. Absent is the ordinary state — a set that has bound nothing, or a
 * project written before the file existed — so it reads as "no bindings" and not as an error.
 * A file that is THERE and malformed is a different matter, and `parseMixView` reports it.
 */
export async function readMixView(project: string): Promise<MixView> {
  const path = project === "." ? MIX_VIEW_FILE : `${project}/${MIX_VIEW_FILE}`;
  try {
    return parseMixView((await api.read(path)).content).value ?? {};
  } catch {
    return {};
  }
}

/**
 * The CUE SHEET's file, project-relative. Named once — the name is @studio/song's.
 *
 * It used to hold the set's songs as well, and no longer does: which songs a desk draws on is
 * the `playlist:` its surface names (`readPlaylistText` below). What is left here is the half a
 * playlist has no place for — this set's cue points on a song, eight per record, which belong
 * to the desk that plays them rather than to a list other sets read. See docs/setList.md.
 */
export const SONGS_FILE = "songs.yaml";

const inProject = (project: string, file: string) =>
  project === "." ? file : `${project}/${file}`;

/**
 * The playlist a `turntables` surface names, as TEXT — or `null` when it named one and the
 * file is not there.
 *
 * Null and not "" on purpose, and it is the one thing this function decides: "you have not
 * chosen a set list" and "the one you chose is not there" are different states with different
 * fixes, and a desk that showed an empty browser for both would be telling you nothing. The
 * surface naming NONE never reaches here — the caller does not call.
 *
 * The path is the WORKSPACE's and not the project's: `_playlists/` sits at the repository root
 * beside `_modules`, so a set list is the same one whichever project in the workspace is open.
 * `playlistPathOf` is what turns the declared name into it — refusing anything that would leave
 * the folder, which is why the null below covers a hostile name as well as a missing file.
 */
export async function readPlaylistText(name: string): Promise<string | null> {
  const path = playlistPathOf(name);
  if (!path) return null;
  try {
    return (await api.read(path)).content;
  } catch {
    return null;
  }
}

/**
 * songs.yaml as TEXT.
 *
 * Text and not a parse, because a cue is written back INTO it — comments and all. Absent reads
 * as empty rather than as an error: an l8 song can be opened here, and a set written before the
 * file existed still opens.
 */
export async function readSongsText(project: string): Promise<string> {
  try {
    return (await api.read(inProject(project, SONGS_FILE))).content;
  } catch {
    return "";
  }
}

/** …and back. The caller has already edited the text; this only puts it where it came from. */
export async function writeSongsText(
  project: string,
  content: string,
): Promise<void> {
  await api.write(inProject(project, SONGS_FILE), content);
}
