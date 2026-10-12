// mixView.ts — reading the project's `views/mix.yaml`. Its own file because the desk and the
// hook that owns the decks both need it, and neither should have to import the other.

// The shared file routes, direct — an app-level re-export would be a seam over something already shared.
import { projectApi as api } from "@studio/project-shell/project";
import { playlistPathOf } from "@studio/song-schema/playlist";
import { MIX_BASE } from "@studio/song-schema/yaml/mixFile";
import {
  MIX_VIEW_BASE,
  parseMixView,
  VIEWS_DIR,
} from "@studio/song-schema/yaml/mixViewFile";
import type { MixView } from "@studio/song-schema/yaml/mixViewSchema";

/** Absent is a 404 and nothing else: a blip read as "empty" is how a cue sheet gets written over. */
const absent = (e: unknown): boolean =>
  (e as { status?: number } | null)?.status === 404;

/** The bindings file, project-relative. Named once — the name is @studio/song's. */
export const MIX_VIEW_FILE = `${VIEWS_DIR}/${MIX_VIEW_BASE}.yaml`;

/** Read the desk's bindings — absent is ordinary and reads as none, any other failure throws; malformed is `parseMixView`'s business. */
export async function readMixView(project: string): Promise<MixView> {
  const path = project === "." ? MIX_VIEW_FILE : `${project}/${MIX_VIEW_FILE}`;
  try {
    return parseMixView((await api.read(path)).content).value ?? {};
  } catch (e) {
    if (absent(e)) return {};
    throw e;
  }
}

/** The CUE SHEET at the project ROOT — not `views/mix.yaml` above, same base. See ../docs/cues.md. */
export const MIX_FILE = `${MIX_BASE}.yaml`;

const inProject = (project: string, file: string) =>
  project === "." ? file : `${project}/${file}`;

/** The named playlist as TEXT, `null` when it is not there — a WORKSPACE path; any other failure throws. See ../docs/setList.md. */
export async function readPlaylistText(name: string): Promise<string | null> {
  const path = playlistPathOf(name);
  if (!path) return null;
  try {
    return (await api.read(path)).content;
  } catch (e) {
    if (absent(e)) return null;
    throw e;
  }
}

/** mix.yaml as TEXT, because a cue is written back INTO it — absent reads as empty, any other failure throws. */
export async function readMixText(project: string): Promise<string> {
  try {
    return (await api.read(inProject(project, MIX_FILE))).content;
  } catch (e) {
    if (absent(e)) return "";
    throw e;
  }
}

/** …and back. The caller has already edited the text; this only puts it where it came from. */
export async function writeMixText(
  project: string,
  content: string,
): Promise<void> {
  await api.write(inProject(project, MIX_FILE), content);
}
