// fields.ts — the editor's field vocabulary, DERIVED from the Zod schemas rather than
// hand-kept: add a field to a schema and it is offered, so the two cannot drift. Each
// kind of file answers for itself, which a single flat table could not do.

import type { z } from "zod";
import { SHAPE_KINDS } from "../moduleTypes";
import {
  CHAIN_STARTS,
  ChainFileSchema,
  LinkSchema,
  NODE_ITEM_KEYS,
} from "./chainSchema";
import {
  AdsrCurveSchema,
  AudioClipSchema,
  CustomCurveSchema,
  FadeSchema,
  LfoCurveSchema,
  NoteSchema,
  SequenceSchema,
  VideoClipSchema,
  VideoPlacementSchema,
  VideoTrackSchema,
  WarpSchema,
} from "./entitySchemas";
import { GraphFileSchema } from "./graphSchema";
import {
  AlternativeSchema,
  IO_KINDS,
  ModuleSchema,
  RackSchema,
  RackSoundSchema,
  UISchema,
  WAVEFORM_SOURCES,
  WIDGET_TYPES,
} from "./moduleSchema";
import { PlacementSchema } from "./placementSchema";
import { ProjectFileSchema, ProjectSettingsSchema } from "./projectSchema";

const keys = (schema: z.ZodObject<z.ZodRawShape>): string[] =>
  Object.keys(schema.shape);

// One flat set — the per-type narrowing is a refinement, not a union, so these come off the base object it wraps.
const WIDGET_FIELDS = [
  "type",
  "col",
  "row",
  "colSpan",
  "rowSpan",
  "label",
  "hidden",
  "text",
  "bind",
  "min",
  "max",
  "step",
  "curve",
  "source",
  "options",
  "library",
];

/** The kind of file being edited — what the path is relative to. */
export type FileKind =
  | "module"
  | "chains"
  // One file of a chain project's `chains/`, its nodes inline — docs/fields.md.
  | "chain"
  | "clip"
  | "sequence"
  | "curve"
  | "video_track"
  | "project";

/** Which kind a project-relative path is, or null — by FOLDER and not by extension, see docs/fields.md. */
export function fileKindFor(path?: string): FileKind | null {
  const p = (path ?? "").replace(/\\/g, "/");
  if (!p) return null;
  if (/(^|\/)modules\//.test(p)) return "module";
  if (/(^|\/)nodes\//.test(p)) return "module";
  // A chain project's lane file is a module file, and its chain files a kind of their own.
  if (/(^|\/)tracks\//.test(p)) return "module";
  // A library's older chain FOLDER keeps a segments file, which is not a chain file.
  if (/(^|\/)chains\/(.+\/)?graph\.ya?ml$/.test(p)) return "chains";
  if (/(^|\/)chains\/.+\.ya?ml$/.test(p)) return "chain";
  if (/(^|\/)clips\//.test(p)) return "clip";
  if (/(^|\/)sequences\//.test(p)) return "sequence";
  if (/(^|\/)curves\//.test(p)) return "curve";
  if (/(^|\/)video_tracks\//.test(p)) return "video_track";
  if (/(^|\/)chains\.ya?ml$/.test(p)) return "chains";
  if (/(^|\/)project\.ya?ml$/.test(p)) return "project";
  return null;
}

/** The fields allowed in the mapping at `path` — the editor's key path, `[]` at the top level. */
export function fieldsAt(kind: FileKind, path: string[]): string[] {
  if (kind === "module") return moduleFields(path);
  if (kind === "chains") return chainFields(path);
  if (kind === "chain") return chainFileFields(path);
  if (kind === "project") return projectFields(path);
  if (kind === "clip") return clipFields(path);
  if (kind === "sequence") return sequenceFields(path);
  if (kind === "curve") return curveFields(path);
  return videoTrackFields(path);
}

/** project.yaml has TWO tiers, and mixing them up put `libraries_from` at the top level doing nothing (docs/fields.md). */
function projectFields(path: string[]): string[] {
  if (path.length === 0) return keys(ProjectFileSchema);
  if (path[0] === "project" && path.length === 1)
    return keys(ProjectSettingsSchema);
  return []; // markers is a free timecode -> label map
}

/** Both clip flavours' fields — which applies depends on the source's extension. */
function clipFields(path: string[]): string[] {
  if (path.length === 0)
    return [...new Set([...keys(AudioClipSchema), ...keys(VideoClipSchema)])];
  if (path[0] === "warp") return keys(WarpSchema);
  return [];
}

function sequenceFields(path: string[]): string[] {
  if (path.length === 0) return keys(SequenceSchema);
  if (path[0] === "notes") return keys(NoteSchema);
  return [];
}

/** Every curve flavour's, since `type` decides which and it may not be written yet. */
function curveFields(path: string[]): string[] {
  if (path.length === 0)
    return [
      ...new Set([
        ...keys(LfoCurveSchema),
        ...keys(CustomCurveSchema),
        ...keys(AdsrCurveSchema),
      ]),
    ];
  if (path[0] === "points") return ["time", "value"];
  return [];
}

function videoTrackFields(path: string[]): string[] {
  if (path.length === 0) return keys(VideoTrackSchema);
  // Inside a fade's map, which is a placement field but not a placement — its own two words.
  if (path[0] === "events" && (path[1] === "fade_in" || path[1] === "fade_out"))
    return keys(FadeSchema);
  if (path[0] === "events") return keys(VideoPlacementSchema);
  // A shape's fields depend on its `type`; offer every kind's, as the top level does.
  if (path[0] === "shapes")
    return [
      ...new Set([
        "type",
        "x",
        "y",
        "w",
        "h",
        "r",
        "background_color",
        "content",
        "font",
      ]),
    ];
  return [];
}

function moduleFields(path: string[]): string[] {
  if (path.length === 0) return keys(ModuleSchema);
  const [head, ...rest] = path;
  // A lane's placements: `events:` is a module field, so no track vocabulary of its own (docs/fields.md).
  if (head === "events") return keys(PlacementSchema);
  // One of the module's other attribute SETS: the same fields it has itself, plus a name (docs/alternatives.md).
  if (head === "alternatives")
    return rest.length ? keys(AlternativeSchema) : [];
  if (head === "ui") {
    if (rest.length === 0) return keys(UISchema);
    // widgets/<id>, and a tab's: tabs/<i> is a name and widgets, tabs/<i>/widgets/<id> a widget.
    if (rest[0] === "widgets") return rest.length === 1 ? [] : WIDGET_FIELDS;
    if (rest[0] === "tabs") {
      if (rest.length === 2) return ["name", "widgets"];
      if (rest[2] === "widgets") return rest.length === 3 ? [] : WIDGET_FIELDS;
    }
    return [];
  }
  if (head === "rack") {
    if (rest.length === 0) return rackFields();
    if (rest[0] === "symbols")
      return rest.length === 1 ? [] : keys(RackSoundSchema);
    return [];
  }
  // `params` is a free map and `plugin` is deliberately open — nothing to offer in either.
  return [];
}

/** Both rack flavours' fields, since which one applies depends on `rack_type`. */
function rackFields(): string[] {
  const flavours = (
    RackSchema as unknown as { options: z.ZodObject<z.ZodRawShape>[] }
  ).options;
  return [...new Set(flavours.flatMap(keys))];
}

function chainFields(path: string[]): string[] {
  // The file has three sections and nothing else; inside one the keys are node NAMES (hints.ts supplies those).
  if (path.length === 0) return keys(GraphFileSchema);
  return [];
}

/** A chain file: its own keys, then under `steps` a node's (a module's plus the item's), a lane's and a link's. */
function chainFileFields(path: string[]): string[] {
  if (path.length === 0) return keys(ChainFileSchema);
  if (path[0] !== "steps") return [];
  const rest = path.slice(1);
  if (rest.length === 0)
    return [
      ...new Set(["to", "track", ...NODE_ITEM_KEYS, ...keys(ModuleSchema)]),
    ];
  if (rest[0] === "to") return rest.length === 1 ? keys(LinkSchema) : [];
  return moduleFields(rest);
}

/** The values allowed for a field whose schema is a closed set. Empty for free text. */
export function valuesAt(
  kind: FileKind,
  path: string[],
  field: string,
): string[] {
  if (kind === "module") {
    if (path.length === 0 && field === "type")
      return ["plugin", "rack", "video_effect", "video_transition"];
    if (path.length === 0 && field === "io") return [...IO_KINDS];
    if (path.length === 0 && field === "shape") return [...SHAPE_KINDS];
    if (path.length === 0 && field === "monitor") return ["off", "auto", "on"];
    if (path[0] === "ui" && field === "type") return [...WIDGET_TYPES];
    if (path[0] === "ui" && field === "curve") return ["lin", "log"];
    if (path[0] === "ui" && field === "source") return [...WAVEFORM_SOURCES];
    if (path[0] === "rack" && field === "rack_type")
      return ["samples", "slice"];
    return [];
  }
  if (kind === "curve") {
    if (path.length === 0 && field === "type") return ["lfo", "custom"];
    if (path.length === 0 && field === "polarity")
      return ["unipolar", "bipolar"];
    if (path.length === 0 && field === "shape")
      return ["sine", "triangle", "saw", "square"];
    return [];
  }
  if (kind === "chain") {
    if (path.length === 0 && field === "start")
      return ["true", ...CHAIN_STARTS];
    return path[0] === "steps" ? valuesAt("module", path.slice(1), field) : [];
  }
  if (kind === "video_track") return [];
  return [];
}
