// projectLifecycle.ts — creating a project in a workspace: from scratch (the same
// scaffold `lanes create` runs) or by translating a .dawproject archive. Extracted
// from workspace.ts; both re-root the output INSIDE the workspace and guard the path
// through the host's safePath.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { findEngineBinary } from "@lanes/engine-client/engineBinary";
import { scaffold } from "@lanes/song/scaffold";
import { parseDawproject } from "@lanes/translator/dawproject";
import { emitFolder } from "@lanes/translator/emit";
import { resolvePluginParams } from "@lanes/translator/params";

/** What the lifecycle functions need from their workspace — the path guards. */
export interface LifecycleHost {
  readonly root: string;
  /** Resolve `rel` inside the workspace, or throw (path-traversal + symlink guard). */
  safePath(rel: string): string;
  toRel(abs: string): string;
}

/**
 * Import a .dawproject archive at `rel` into a NEW project folder in this workspace,
 * returning the new project's workspace-relative path plus a human-readable LOG (what
 * was read, the counts, any warnings the mapper raised, where it landed) — the UI shows
 * it in the import popin so a lossy import (a dropped clip, an unmatched plugin) is
 * visible rather than silent.
 *
 * The translation is @lanes/translator's — the very code `lanes import` runs;
 * this only re-roots the output INSIDE the workspace (never `dirname(input)`, which the
 * CLI uses but which here could plant a project inside another). Plugin presets resolve
 * to text params when the engine binary is present, exactly as the CLI does; without it
 * the .vstpreset assets are kept, so an import never fails for lack of an engine.
 */
export function importDawprojectInto(
  host: LifecycleHost,
  rel: string,
): { project: string; log: string[] } {
  const abs = host.safePath(rel);
  if (!existsSync(abs)) throw new Error(`no such file: ${rel}`);
  const stem = basename(abs, extname(abs));
  const { song, files, stats, warnings } = parseDawproject(
    new Uint8Array(readFileSync(abs)),
    stem,
  );
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
    ...warnings.map((w) => `warning: ${w}`),
    `wrote ${project}`,
  ];
  return { project, log };
}

/**
 * Scaffold a NEW project folder at the workspace root, returning its workspace-
 * relative path. This is the web command bar's `new project <type> <name>`. `type` is
 * "audio" (the default variant) or "video" (adds picture: a viewport, the bundled
 * sample clip, and two video tracks).
 *
 * The name is sanitised to a single top-level segment (no separators, no leading dot
 * that would hide it) so it always lands directly under the root. Refuses to write over
 * an existing non-empty folder — same contract as the CLI — rather than silently
 * uniquify, so the project lands at exactly the name the user typed or not at all.
 */
export function createProjectIn(
  host: LifecycleHost,
  type: "audio" | "video",
  rawName: string,
): { project: string } {
  const name = rawName.trim().replace(/[/\\]/g, "_").replace(/^\.+/, "");
  if (!name) throw new Error("project name required");
  const abs = host.safePath(name);
  if (abs === host.root) throw new Error("project name required");
  if (existsSync(abs) && readdirSync(abs).length)
    throw new Error(`"${name}" already exists and is not empty`);
  scaffold(abs, name, type === "video");
  return { project: host.toRel(abs) };
}
