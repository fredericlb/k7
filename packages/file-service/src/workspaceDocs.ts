// workspaceDocs.ts — the derived documents a workspace answers that are pure functions of a folder
// and its compile: the error list, the browser's picture, the empty completion vocabulary and the
// project's name. The CACHES stay on Workspace, keyed on its revision. See docs/workspace.md.

import { basename, join } from "node:path";
import { assemblyIssues } from "@studio/song/assemblies";
import { deadAutomations } from "@studio/song/deadAutomations";
import {
  type Diagnostic,
  deadProjectFields,
  libraryModuleIssues,
  notSupportedModules,
} from "@studio/song/loader";
import type { ProjectDoc } from "@studio/song/project";
import { surfaceIssues } from "@studio/song/surfaces";
import { wsRead } from "@studio/song/yaml/workspaceFile";
import type { VideoProjectDoc } from "@studio/song-video/videoDoc";
import { videoDuration } from "@studio/song-video/videoTracks";
import type { Hints, ProjectInfo, WebVideoProject } from "@studio/web-protocol";
import { parse as parseYaml } from "yaml";
import { toWebVideoTracks, webPlugin } from "./webTracks.ts";

// Turn a compiler error into editor diagnostics; a line with no "<file>: " prefix yields none but still counts.
function parseCompileError(msg: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of msg.split("\n")) {
    const m = /^\s*(\S+\.(?:ya?ml|k7x))(?::(\d+))?:\s*(.+)$/i.exec(line);
    if (m)
      out.push({
        file: m[1].replace(/^\.\//, ""),
        line: m[2] ? Number(m[2]) : 1,
        col: 1,
        message: m[3].trim(),
      });
  }
  return out;
}

/** Everything wrong with the project at `dir`: the compile's throw, else its non-blocking warnings. */
export function projectErrorsIn(
  dir: string,
  compile: () => ProjectDoc,
): { errors: string[]; diagnostics: Diagnostic[] } {
  try {
    const doc = compile();
    // Clean — but the non-blocking WARNINGS below surface here or nowhere at all.
    return {
      errors: [],
      diagnostics: [
        ...notSupportedModules(dir),
        // A curve the engine will refuse, which it otherwise only logs.
        ...deadAutomations(dir, doc),
        ...libraryModuleIssues(dir),
        ...deadProjectFields(dir),
        // A `surfaces/` file that is THERE and malformed draws nothing, and says nothing either.
        ...surfaceIssues(dir),
        // …and an assembly whose template is not in the library draws a box with no plugs.
        ...assemblyIssues(dir),
      ],
    };
  } catch (e) {
    const diagnostics = parseCompileError((e as Error).message);
    const errors = diagnostics.length
      ? diagnostics.map((d) => `${d.file}: ${d.message}`)
      : [(e as Error).message];
    return { errors, diagnostics };
  }
}

/** The completion vocabulary with no project open, or one that will not read. */
export const EMPTY_HINTS: Hints = {
  baseModules: [],
  ioSinks: [],
  modules: [],
  tracks: [],
  channels: [],
  clips: [],
  videoTracks: [],
  sequences: [],
  chains: [],
  moduleAssets: {},
  paramsByBase: {},
  paramMetaByBase: {},
  racks: {},
  keywords: [],
  pluginNames: {},
  paths: {},
  projectRoot: "",
  media: {},
};

/** The picture of a song that has none — never a throw, since every song may carry one. */
export function emptyVideoProject(dir: string): WebVideoProject {
  return {
    name: basename(dir),
    viewport: [0, 0],
    fps: 0,
    duration: 0,
    markers: [],
    videoTracks: [],
    framePlugins: [],
    transitions: {},
    stretches: {},
  };
}

/** A compiled picture as the browser reads it, every path workspace-relative. */
export function webVideoProjectOf(
  p: VideoProjectDoc,
  toRel: (abs: string) => string,
): WebVideoProject {
  return {
    name: p.name,
    viewport: p.viewport,
    fps: p.fps,
    duration: videoDuration(p.videoTracks),
    markers: p.markers.map((m) => ({ sec: m.sec, name: m.name, tc: m.tc })),
    videoTracks: toWebVideoTracks(p.videoTracks, toRel),
    framePlugins: p.framePlugins.map((pl) => webPlugin(pl, toRel)),
    transitions: Object.fromEntries(
      Object.entries(p.transitions).map(([k, t]) => [
        k,
        { ...t, params: { ...t.params } },
      ]),
    ),
    stretches: Object.fromEntries(
      Object.entries(p.stretches).map(([k, run]) => [
        k,
        run.map((pl) => webPlugin(pl, toRel)),
      ]),
    ),
  };
}

/** The project's own name from `project.yaml`, else its folder's. */
export function projectInfoOf(dir: string): ProjectInfo {
  let name = basename(dir);
  try {
    const root = parseYaml(wsRead(join(dir, "project.yaml"))) as {
      project?: { name?: unknown };
    } | null;
    if (typeof root?.project?.name === "string") name = root.project.name;
  } catch {
    /* no project.yaml — keep the folder name */
  }
  return { name, root: dir };
}

/** What `fn` answers off a compile, or nothing when the project will not compile. */
export function ifCompiles<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
