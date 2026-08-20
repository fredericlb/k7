// projectLifecycle.ts — creating a project in a workspace: from scratch (the same
// scaffold `st0 create` runs) or by translating a foreign project (.dawproject, .als).
// Extracted from workspace.ts; both re-root the output INSIDE the workspace and guard the
// path through the host's safePath. See docs/import.md for the sample-path rule.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, posix } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { scaffold } from "@studio/song/scaffold";
import { scaffoldSet } from "@studio/song/scaffoldSet";
import type { ProjectShape } from "@studio/song/yaml/projectSchema";
import { parseAls, type SampleRef } from "@studio/translator/ableton";
import { parseDawproject } from "@studio/translator/dawproject";
import { emitFolder } from "@studio/translator/emit";
import type { Translation } from "@studio/translator/model";
import { resolvePluginParams } from "@studio/translator/params";
import {
  PROJECT_SUFFIXES,
  projectApp,
  projectLabel,
} from "@studio/web-protocol/projects";

/** What the lifecycle functions need from their workspace — the path guards. */
export interface LifecycleHost {
  readonly root: string;
  /** Resolve `rel` inside the workspace, or throw (path-traversal + symlink guard). */
  safePath(rel: string): string;
  toRel(abs: string): string;
}

/** The foreign project formats this workspace can translate, by extension. */
export const IMPORTABLE = [".dawproject", ".als"] as const;

/**
 * Resolve one Live sample reference to bytes, or null.
 *
 * A .als carries ABSOLUTE paths from whatever machine wrote it — a real set holds several
 * users' home directories and even VST binary paths. Honouring those would let a crafted .als
 * read any file on the engine's machine, so only Live's own project-relative path is followed,
 * and only through `safePath`. The cost is deliberate and visible: a set that never went
 * through "Collect All and Save" has no relative paths, and imports without audio.
 */
function makeSampleReader(
  host: LifecycleHost,
  alsRel: string,
  outsideWorkspace: Set<string>,
): (ref: SampleRef) => Uint8Array | null {
  const baseRel = posix.dirname(alsRel.replace(/\\/g, "/"));
  return (ref) => {
    if (!ref.relative) {
      // Counted by FILE, not by reference: nine clips off five files is five things to go and collect.
      outsideWorkspace.add(ref.absolute ?? ref.name);
      return null;
    }
    const candidate = posix.join(baseRel, ref.relative.replace(/\\/g, "/"));
    try {
      const abs = host.safePath(candidate);
      if (!existsSync(abs) || !statSync(abs).isFile()) return null;
      return new Uint8Array(readFileSync(abs));
    } catch {
      // safePath threw: the reference escapes the workspace. Report it, never read it.
      outsideWorkspace.add(ref.relative);
      return null;
    }
  };
}

/**
 * Import a foreign project at `rel` (.dawproject or .als) into a NEW project folder in this
 * workspace, returning the new project's workspace-relative path plus a human-readable LOG
 * (what was read, the counts, any warnings the mapper raised, where it landed) — the UI shows
 * it in the import popin so a lossy import (a dropped clip, an unmatched plugin) is visible
 * rather than silent.
 *
 * The translation is @studio/translator's; this only re-roots the output INSIDE the workspace
 * (never `dirname(input)`, which would plant a project inside another). Plugin presets resolve
 * to text params when the engine binary is present; without it the .vstpreset assets are kept,
 * so an import never fails for lack of an engine.
 */
export function importProjectInto(
  host: LifecycleHost,
  rel: string,
): { project: string; log: string[] } {
  const abs = host.safePath(rel);
  if (!existsSync(abs)) throw new Error(`no such file: ${rel}`);
  const stem = basename(abs, extname(abs));
  const ext = extname(abs).toLowerCase();
  const bytes = new Uint8Array(readFileSync(abs));

  const outsideWorkspace = new Set<string>();
  let translation: Translation;
  if (ext === ".als")
    translation = parseAls(bytes, stem, {
      readSample: makeSampleReader(host, rel, outsideWorkspace),
    });
  else if (ext === ".dawproject") translation = parseDawproject(bytes, stem);
  else
    throw new Error(
      `cannot import "${rel}": expected one of ${IMPORTABLE.join(", ")}`,
    );
  const { song, files, stats, warnings } = translation;
  // A fresh top-level folder so it lists as its own project: sanitised, and uniquified so a re-import can't clobber.
  const base = stem.replace(/[/\\]/g, "_").replace(/^\.+/, "") || "imported";
  let name = base;
  for (let n = 2; existsSync(join(host.root, name)); n++) name = `${base}-${n}`;
  const outAbs = host.safePath(name);
  try {
    resolvePluginParams(song, files, findEngineBinary() ?? undefined);
  } catch {
    /* a dump failure just means the presets stay as .vstpreset assets */
  }
  emitFolder(outAbs, song, files);
  const project = host.toRel(outAbs);
  const log = [
    `read ${rel}`,
    `project "${song.project.name}" — ${song.project.tempo} bpm, ${song.project.timeSignature}, ${song.project.sampleRate} Hz`,
    `${stats.tracks} tracks · ${stats.audioClips} audio clips · ${stats.midiClips} MIDI clips · ${stats.notes} notes · ${stats.assets} assets`,
    // Said apart from the mapper's per-sample warnings because this is the one with a FIX: an import
    // that lands silent is otherwise unexplainable, and Collect All and Save is what carries the audio.
    ...(outsideWorkspace.size
      ? [
          `warning: ${outsideWorkspace.size} sample(s) live outside the workspace and were not read — in Live, use File > Collect All and Save, then re-import`,
        ]
      : []),
    ...warnings.map((w) => `warning: ${w}`),
    `wrote ${project}`,
  ];
  return { project, log };
}

/**
 * Which scaffold each ARCHETYPE runs — the one place the three are told apart.
 *
 * A `Record<ProjectShape, …>` rather than a chain of `if`s, for the reason `HAS_SCAFFOLD` is
 * one: a fourth archetype added to `PROJECT_SHAPES` fails to compile here until somebody says
 * what it writes. The alternative — an `else` quietly running the song scaffold — is how a
 * folder ends up with a suffix saying one thing and its contents another.
 *
 * The two callees disagree about their second argument, and the table is where that shows:
 * `scaffoldSet` is handed the LABEL (`winter`), `scaffold` the folder name (`winter.st0`), so a
 * new mix calls itself one thing and a new song another. Preserved rather than quietly
 * levelled — what a project calls itself is on screen, and changing it is its own decision.
 */
const SCAFFOLD_FOR_SHAPE: Record<
  ProjectShape,
  (dir: string, name: string) => void
> = {
  arrangement: (dir, name) => void scaffold(dir, name, "arrangement"),
  // The label a project CALLS itself drops the suffix — `winter.st0` is the folder, "winter"
  // is the mix. projectLabel is the one place that rule is stated.
  mix: (dir, name) => void scaffoldSet(dir, projectLabel(name)),
  video: (dir, name) => void scaffold(dir, name, "video"),
};

/**
 * Scaffold a NEW project folder at the workspace root, returning its workspace-
 * relative path. This is `POST /project/create`, which pl8's "Nouveau projet" calls.
 *
 * Every one of them is an `.st0` folder, and `shape` — the ARCHETYPE — picks the file map. Each
 * is named after the surface it opens on, because that is the whole of what is being chosen:
 *
 * | archetype | what it writes |
 * |---|---|
 * | `arrangement` | a `timeline` surface: a lane, a synth, a pattern |
 * | `mix` | a `turntables` surface: two decks meeting at a crossfade, an empty set list |
 * | `video` | `timeline` + `viewport`: the arrangement, plus a lane of picture |
 *
 * One kind of folder, three archetypes. A cut is a song carrying `video_tracks/`, and a mix is
 * a project carrying `songs.yaml` and a desk — neither needs a folder kind of its own. See
 * packages/song/docs/setProject.md and docs/picture.md.
 *
 * The name is sanitised to a single top-level segment (no separators, no leading dot
 * that would hide it) so it always lands directly under the root. Refuses to write over
 * an existing non-empty folder — same contract as the CLI — rather than silently
 * uniquify, so the project lands at exactly the name the user typed or not at all.
 */
export function createProjectIn(
  host: LifecycleHost,
  shape: ProjectShape,
  rawName: string,
): { project: string } {
  const name = rawName.trim().replace(/[/\\]/g, "_").replace(/^\.+/, "");
  if (!name) throw new Error("project name required");
  const abs = host.safePath(name);
  if (abs === host.root) throw new Error("project name required");
  if (existsSync(abs) && readdirSync(abs).length)
    throw new Error(`"${name}" already exists and is not empty`);
  SCAFFOLD_FOR_SHAPE[shape](abs, name);
  return { project: host.toRel(abs) };
}
