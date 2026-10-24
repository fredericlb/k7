// entities.ts — a project's flat entity folders and root files read in: clips, sequences, video
// lanes, settings, the project root, its graph and its cue list, each validated with Zod so a
// bad key arrives with its file and line. What a reader gets wrong: clips/ holds every kind
// alike, and the kind is read off the source's extension. See docs/loader.md.

import { join } from "node:path";
import {
  checkFormatLevel,
  formatLevelOf,
  formatLevelOfText,
} from "@studio/song-schema/formatLevel";
import {
  CAPTION_SOURCE,
  ENTITY_SCHEMAS,
  isPictureSource,
  VIDEO_SOURCE,
} from "@studio/song-schema/yaml/entitySchemas";
import { parseGraph } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_BASE } from "@studio/song-schema/yaml/graphSchema";
import { cueRefs, MIX_BASE, parseMix } from "@studio/song-schema/yaml/mixFile";
import { formatIssue } from "@studio/song-schema/yaml/moduleFile";
import {
  ProjectFileSchema,
  SettingsSchema,
} from "@studio/song-schema/yaml/projectSchema";
import type { ZodType } from "zod";
import {
  isChainProject,
  readChainProject,
  readLayout,
  toSegments,
} from "./chainProject";
import { bypassedOf } from "./chainsGraph";
import { loadModuleRefs } from "./moduleRefs";
import { resolveModuleMap } from "./moduleResolve";
import { loadModules } from "./moduleTree";
import type {
  RawProjectRoot,
  RawVideoPlacement,
  RawVideoTrack,
} from "./rawDoc";
import { type Lane, lanesOf, pictureLanesOf } from "./trackModule";
import { entityFileFor, entityFiles } from "./yaml/moduleIO";
import { wsData, wsText } from "./yaml/workspaceDoc";
import { wsExists } from "./yaml/workspaceFile";
import { parsedData } from "./yaml/yamlCache";

// clips/ holds every kind identically ({source}), so the kind is read off the extension, by song-schema's patterns.
export const isVideoSource = (source: string): boolean =>
  VIDEO_SOURCE.test(source);

/** A clip the PICTURE reads — a video, a still or captions — rather than an audio one (song-video docs/media.md). */
export const readsAsPicture = (source: string): boolean =>
  isPictureSource(source) || CAPTION_SOURCE.test(source);

// The entities in a subdirectory, keyed by id ({} if the subdir doesn't exist).
export const exportSub = (dir: string, sub: string): any =>
  readYamlEntities(dir, sub).values;

// The entities in `sub` keyed by id, validated against the kind's schema when there is one (yaml/entitySchemas.ts).
export function readYamlEntities(
  dir: string,
  sub: string,
): { values: Record<string, unknown>; issues: string[] } {
  const values: Record<string, unknown> = {};
  const issues: string[] = [];
  const folder = join(dir, sub);
  if (!wsExists(folder)) return { values, issues };
  const schema = (ENTITY_SCHEMAS as Record<string, ZodType | undefined>)[sub];
  for (const { id, file } of entityFiles(folder, sub)) {
    // Cached only when a schema will rebuild the result, since a cached object handed out raw is a shared object.
    const raw = schema ? parsedData(file.path) : wsData(file.path);
    if (!schema) {
      values[id] = raw;
      continue;
    }
    const r = schema.safeParse(raw ?? {});
    if (r.success) values[id] = r.data;
    else
      for (const i of r.error.issues)
        issues.push(
          `${file.rel}: ${i.path.map(String).join(".") || "(root)"}: ${i.message}`,
        );
  }
  return { values, issues };
}

// A project's LANES keyed by node name: there is no `tracks/` folder, only the nodes that fold out to one (docs/trackModules.md).
export function loadLanes(dir: string, validate = false): Record<string, Lane> {
  return lanesOf(
    resolveModuleMap(loadModules(dir, validate), loadModuleRefs(dir)),
  );
}

/** A `@meta/picture-track` node as the picture compile reads a lane: its rect, its mute off the graph's bypass. */
function pictureLaneTrack(
  id: string,
  lane: Lane,
  muted: boolean,
): RawVideoTrack {
  const [x, y, w, h] = lane.frame ?? [];
  return {
    name: id,
    ...(lane.color ? { color: lane.color } : {}),
    ...(muted || lane.disabled ? { mute: true } : {}),
    ...(lane.frame ? { x, y, w, h } : {}),
    events: lane.events as RawVideoPlacement[],
  };
}

// The PICTURE lanes: the `@meta/picture-track` nodes, mute read off the graph's bypass (docs/trackModules.md).
export function loadVideoTracks(
  dir: string,
  validate = false,
): Record<string, RawVideoTrack> {
  const lanes = pictureLanesOf(
    resolveModuleMap(loadModules(dir, validate), loadModuleRefs(dir)),
  );
  if (!Object.keys(lanes).length) return {};
  const bypassed = bypassedOf(loadChains(dir, loadProjectRoot(dir)));
  return Object.fromEntries(
    Object.entries(lanes).map(([id, lane]) => [
      id,
      pictureLaneTrack(id, lane, bypassed.has(id)),
    ]),
  );
}

// Project settings (settings.k7x), a flat struct; {} when absent, coerced and defaulted by parseSettings.
export function loadSettings(
  dir: string,
  validate = false,
): Record<string, unknown> {
  const found = entityFileFor(dir, "", "settings");
  if (!found) return {};
  const raw = wsData(found.path);
  const r = SettingsSchema.safeParse(raw ?? {});
  if (!r.success && validate)
    throw new Error(
      [
        "invalid settings:",
        ...r.error.issues.map(
          (i) =>
            `  ${found.rel}: ${i.path.map(String).join(".")}: ${i.message}`,
        ),
      ].join("\n"),
    );
  return r.success ? r.data : {};
}

const relOf = (file: { rel: string }): string => file.rel.replace(/^\/+/, "");

// Throws FormatTooNewError when the project root's RAW text declares a newer format; reads no further.
export function checkProjectFormat(dir: string): void {
  const file = entityFileFor(dir, "", "project");
  if (file) checkFormatLevel(formatLevelOfText(wsText(file.path)), relOf(file));
}

// The project's ROOT — `project`, `trackOrder`, `markers` — from `project.k7x`; `chains` is read separately.
export function loadProjectRoot(dir: string, validate = false): RawProjectRoot {
  const file = entityFileFor(dir, "", "project");
  if (!file) return {};
  // A newer format is refused whether or not this read validates, so no writer clobbers it (song-schema docs/formatLevel.md).
  checkFormatLevel(formatLevelOfText(wsText(file.path)), relOf(file));
  const raw = wsData(file.path);
  checkFormatLevel(formatLevelOf(raw), relOf(file));
  const r = ProjectFileSchema.safeParse(raw ?? {});
  if (!r.success) {
    if (validate)
      throw new Error(
        [
          "invalid project:",
          ...r.error.issues.map(
            (i) =>
              `  ${file.rel}: ${i.path.map(String).join(".") || "(root)"}: ${i.message}`,
          ),
        ].join("\n"),
      );
    return {};
  }
  return r.data;
}

// The project's routing segments, from `graph.k7x` when it exists, else inlined in project.k7x (chainsGraph.ts derives the runs).
export function loadChains(
  dir: string,
  root: RawProjectRoot,
  validate = false,
): unknown {
  if (isChainProject(dir)) {
    const cp = readChainProject(dir);
    if (cp.issues.length && validate)
      throw new Error(`invalid chains:\n  ${cp.issues.join("\n  ")}`);
    return toSegments(cp, readLayout(dir)).graph;
  }
  const file = entityFileFor(dir, "", GRAPH_BASE);
  if (!file) return root?.chains;
  const { value, issues } = parseGraph(wsText(file.path));
  if (issues.length && validate)
    throw new Error(
      `invalid chains:\n  ${issues
        .map((i) => formatIssue(file.rel, i))
        .join("\n  ")}`,
    );
  return value;
}

// The songs the desk's CUE SHEET names, from `mix.k7x`, deduplicated and sorted but NOT resolved — see docs/mixFile.md.
export function loadCuedSongs(dir: string, validate = false): string[] {
  const file = entityFileFor(dir, "", MIX_BASE);
  if (!file) return [];
  const { value, issues } = parseMix(wsText(file.path));
  if (issues.length && validate)
    throw new Error(
      `invalid cue sheet:\n  ${issues
        .map((i) => formatIssue(file.rel, i))
        .join("\n  ")}`,
    );
  return cueRefs(value);
}
