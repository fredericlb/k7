// mixView.ts — reading the project's `views/mix.yaml`. Its own file because the desk and the
// hook that owns the decks both need it, and neither should have to import the other.

import {
  MIX_VIEW_BASE,
  parseMixView,
  VIEWS_DIR,
} from "@studio/song/yaml/mixViewFile";
import type { MixView } from "@studio/song/yaml/mixViewSchema";
import { api } from "./api";

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

/** The set list's file, project-relative. Named once — the name is @studio/song's. */
export const SONGS_FILE = "songs.yaml";

const inProject = (project: string, file: string) =>
  project === "." ? file : `${project}/${file}`;

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
