// entities.ts — a project's flat entity folders and root files read in: clips, sequences, video
// lanes, settings, the project root, its graph and its cue list, each validated with Zod so a
// bad key arrives with its file and line. What a reader gets wrong: clips/ holds every kind
// alike, and the kind is read off the source's extension. See docs/loader.md.

import { join } from "node:path";
import {
  CAPTION_SOURCE,
  ENTITY_SCHEMAS,
  isPictureSource,
  VIDEO_SOURCE,
} from "@studio/song-schema/yaml/entitySchemas";
import { parseGraph as parseGraphYaml } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_BASE } from "@studio/song-schema/yaml/graphSchema";
import {
  cueRefs,
  MIX_BASE,
  parseMix as parseMixYaml,
} from "@studio/song-schema/yaml/mixFile";
import { formatIssue } from "@studio/song-schema/yaml/moduleFile";
import {
  ProjectFileSchema,
  SettingsSchema,
} from "@studio/song-schema/yaml/projectSchema";
import { YAML_READ } from "@studio/song-schema/yaml/yamlText";
import { parse as parseYaml } from "yaml";
import type { ZodType } from "zod";
import {
  isChainProject,
  readChainProject,
  readLayout,
  toSegments,
} from "./chainProject";
import { loadModuleRefs } from "./moduleRefs";
import { resolveModuleMap } from "./moduleResolve";
import { loadModules } from "./moduleTree";
import type { RawProjectRoot, RawVideoTrack } from "./rawDoc";
import { type Lane, lanesOf } from "./trackModule";
import { entityFileFor, entityFiles } from "./yaml/moduleIO";
import { wsExists, wsIssues, wsRead } from "./yaml/workspaceFile";
import { parsedYaml } from "./yaml/yamlCache";

// clips/ holds every kind identically ({source}), so the kind is read off the extension, by song-schema's patterns.
export const isVideoSource = (source: string): boolean =>
  VIDEO_SOURCE.test(source);

/** A clip the PICTURE reads — a video, a still or captions — rather than an audio one (song-video docs/media.md). */
export const readsAsPicture = (source: string): boolean =>
  isPictureSource(source) || CAPTION_SOURCE.test(source);

// The entities in a subdirectory, keyed by id ({} if the subdir doesn't exist).
export const exportSub = (dir: string, sub: string): any =>
  readYamlEntities(dir, sub).values;

// The YAML entities in `sub` keyed by id, validated against the kind's schema when there is one (yaml/entitySchemas.ts).
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
    const raw = schema
      ? parsedYaml(file.path)
      : parseYaml(wsRead(file.path), YAML_READ);
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

// Video lanes, still an ENTITY of their own (video_tracks/<id>.yaml): picture shares nothing with a song's lanes.
// Through readYamlEntities like clips/, so VideoTrackSchema actually gates the compile — docs/loader.md.
export function loadVideoTracks(
  dir: string,
  validate = false,
): Record<string, RawVideoTrack> {
  const { values, issues } = readYamlEntities(dir, "video_tracks");
  if (validate && issues.length)
    throw new Error(`invalid video track(s):\n  ${issues.join("\n  ")}`);
  return values as Record<string, RawVideoTrack>;
}

// Project settings (settings.yaml), a flat struct; {} when absent, coerced and defaulted by parseSettings.
export function loadSettings(
  dir: string,
  validate = false,
): Record<string, unknown> {
  const found = entityFileFor(dir, "", "settings");
  if (!found) return {};
  const raw = parseYaml(wsRead(found.path), YAML_READ);
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

// The project's ROOT — `project`, `trackOrder`, `markers` — from `project.yaml`; `chains` is read separately.
export function loadProjectRoot(dir: string, validate = false): RawProjectRoot {
  const file = entityFileFor(dir, "", "project");
  if (!file) return {};
  const raw = parseYaml(wsRead(file.path), YAML_READ);
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

// The project's routing segments, from `graph.yaml` when it exists, else inlined in project.yaml (chainsGraph.ts derives the runs).
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
  const { value, issues } = parseGraphYaml(wsRead(file.path));
  if (issues.length && validate)
    throw new Error(
      `invalid chains:\n  ${wsIssues(file.path, issues)
        .map((i) => formatIssue(file.rel, i))
        .join("\n  ")}`,
    );
  return value;
}

// The songs the desk's CUE SHEET names, from `mix.yaml`, deduplicated and sorted but NOT resolved — see docs/mixFile.md.
export function loadCuedSongs(dir: string, validate = false): string[] {
  const file = entityFileFor(dir, "", MIX_BASE);
  if (!file) return [];
  const { value, issues } = parseMixYaml(wsRead(file.path));
  if (issues.length && validate)
    throw new Error(
      `invalid cue sheet:\n  ${wsIssues(file.path, issues)
        .map((i) => formatIssue(file.rel, i))
        .join("\n  ")}`,
    );
  return cueRefs(value);
}
