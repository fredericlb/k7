// projectLifecycle.ts — creating a project in a workspace: from scratch (the same
// scaffold `st0 create` runs) or by translating a foreign project (.dawproject, .als).
// Extracted from workspace.ts; both re-root the output INSIDE the workspace and guard the
// path through the host's safePath. See docs/import.md for the sample-path rule.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, posix } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { loadModuleRefs } from "@studio/song/loader";
import {
  projectFiles,
  scaffold,
  videoProjectFiles,
} from "@studio/song/scaffold";
import {
  liveProjectFiles,
  liveVideoProjectFiles,
  scaffoldLive,
  scaffoldLiveVideo,
} from "@studio/song/scaffoldLive";
import { missingRefs, neededRefs } from "@studio/song/scaffoldNeeds";
import { scaffoldSet, setProjectFiles } from "@studio/song/scaffoldSet";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
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

/** Resolve one Live sample reference to bytes: only the project-RELATIVE path, only through `safePath`. */
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

/** Import a .dawproject or .als into a NEW folder in this workspace, answering its path and a LOG. */
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
    // Said apart from the per-sample warnings because this is the one with a FIX: Collect All and Save.
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

/** Which scaffold each ARCHETYPE runs — a Record, so a NEW shape fails to compile until it is named. */
const SCAFFOLD_FOR_SHAPE: Record<
  ProjectShape,
  (dir: string, name: string) => void
> = {
  arrangement: (dir, name) => void scaffold(dir, name, "arrangement"),
  // The label a project CALLS itself drops the suffix; `projectLabel` is where that rule is stated.
  mix: (dir, name) => void scaffoldSet(dir, projectLabel(name)),
  video: (dir, name) => void scaffold(dir, name, "video"),
  // The one archetype that declares no surface — see packages/song/docs/liveProject.md.
  live: (dir, name) => void scaffoldLive(dir, projectLabel(name)),
  // …and the same rig with a lens, whose ONE surface is the frame that lens fills.
  "live-video": (dir, name) => void scaffoldLiveVideo(dir, projectLabel(name)),
};

/** What each ARCHETYPE's file map is, without writing it — so what it will NEED can be read first. */
const FILES_FOR_SHAPE: Record<
  ProjectShape,
  (name: string) => Record<string, string>
> = {
  arrangement: (name) => projectFiles(name),
  mix: (name) => setProjectFiles(projectLabel(name)),
  video: (name) => videoProjectFiles(name),
  live: (name) => liveProjectFiles(projectLabel(name)),
  "live-video": (name) => liveVideoProjectFiles(projectLabel(name)),
};

/** Scaffold a NEW `.st0` folder at the workspace root, its ARCHETYPE picking the file map. */
export function createProjectIn(
  host: LifecycleHost,
  shape: ProjectShape,
  rawName: string,
): { project: string; missing: string[] } {
  const name = rawName.trim().replace(/[/\\]/g, "_").replace(/^\.+/, "");
  if (!name) throw new Error("project name required");
  const abs = host.safePath(name);
  if (abs === host.root) throw new Error("project name required");
  if (existsSync(abs) && readdirSync(abs).length)
    throw new Error(`"${name}" already exists and is not empty`);
  SCAFFOLD_FOR_SHAPE[shape](abs, name);
  // Said HERE because here is where it becomes true; nothing is seeded — see song/src/scaffoldNeeds.ts.
  let missing: string[] = [];
  try {
    missing = missingRefs(
      neededRefs(FILES_FOR_SHAPE[shape](name)),
      loadModuleRefs(abs),
    );
  } catch {
    // The project is written and that is what was asked for; an unreadable ref map is not a failed create.
  }
  return { project: host.toRel(abs), missing };
}
