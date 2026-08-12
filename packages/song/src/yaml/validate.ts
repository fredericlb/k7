// validate.ts — can the compiler read this text? One router over the per-file parsers, so an
// EDITOR can ask about a buffer exactly what the loader asks about a file on disk. Browser-safe
// (yaml + zod, no fs), because the caller is a text pane. See docs/validate.md.

import { LineCounter, parseDocument } from "yaml";
import type { ZodType } from "zod";
import { parseChains } from "./chainsFile";
import {
  ClipSchema,
  CurveSchema,
  SequenceSchema,
  VideoTrackSchema,
} from "./entitySchemas";
import { MIX_VIEW_BASE, parseMixView, VIEWS_DIR } from "./mixViewFile";
import { locate, type ModuleIssue, parseModule } from "./moduleFile";
import {
  ControllerFileSchema,
  ModuleConfigSchema,
  PresetsFileSchema,
} from "./moduleSchema";
import { ProjectFileSchema } from "./projectSchema";
import { parseSongs } from "./songsFile";
import { parseUiFile } from "./uiFile";

// YAML 1.2 for the reason every parser here pins it: `5:1:1` stays a string.
const OPTS = { version: "1.2" as const };

/** How far the check could go — what a caller may conclude from `ok`. */
export type ValidityDepth =
  | "schema" // parsed AND checked against this file's schema
  | "syntax" // parsed; no schema knows this path, so only malformed text is caught
  | "none"; // not YAML at all — nothing here can judge it

export interface Validity {
  /** Nothing found. A file this doesn't recognise is `ok` — silence is not a verdict. */
  ok: boolean;
  issues: ModuleIssue[];
  depth: ValidityDepth;
  /** The text does not PARSE, as opposed to parsing and failing its schema. */
  malformed: boolean;
}

/** Every parser here answers the same shape — that is what lets one router stand over them. */
type Parse = (text: string) => { issues: ModuleIssue[] };

// A located finding is the same thing whichever file it came from; re-exported so a caller
// needs one import rather than one for the answer and one for its shape.
export type { ModuleIssue };

const YAML_EXT = /\.ya?ml$/i;
const segments = (path: string): string[] =>
  path.replace(/\\/g, "/").split("/");

/** A plain schema check, for the kinds that have no parser of their own yet. */
const against =
  (schema: ZodType): Parse =>
  (text) => {
    const lines = new LineCounter();
    const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
    const result = schema.safeParse(doc.toJS({ maxAliasCount: 100 }) ?? {});
    if (result.success) return { issues: [] };
    return {
      issues: result.error.issues.map((issue) => {
        // An unknown key is reported against its CONTAINING object; rebuild the path so it gets a line.
        const keys = (issue as { keys?: string[] }).keys;
        const path = [...issue.path, ...(keys?.length ? [keys[0]] : [])];
        return {
          path: path.map(String).join("."),
          message: issue.message,
          ...locate(doc, lines, path as (string | number)[]),
        };
      }),
    };
  };

/**
 * The parser for a path, or null when no schema claims it.
 *
 * By FOLDER and BASENAME, the same way `fileKindFor` reads a path — plus the module folder's
 * own split, where the panel, the shelf and the MIDI map are each their own document and every
 * OTHER yaml beside them is a use of the module (moduleIO.ts's MODULE_OWN_BASES, pinned by this
 * file's test; it cannot be imported here because it reads the disk).
 */
export function parserFor(path: string): Parse | null {
  const parts = segments(path);
  const base = (parts.at(-1) ?? "").replace(YAML_EXT, "").toLowerCase();
  const dirs = parts.slice(0, -1);
  const inFolder = (name: string) => dirs.includes(name);

  // `_modules` too: a shared library holds the same files, and editing one is what forks it.
  if (inFolder("modules") || inFolder("_modules")) {
    if (base === "ui") return parseUiFile;
    if (base === "presets") return against(PresetsFileSchema);
    if (base === "controller") return against(ControllerFileSchema);
    if (base === "config") return against(ModuleConfigSchema);
    return parseModule; // module.yaml, and every <node>.yaml beside it
  }
  // The project's flat nodes/ folder — LANES included, since a lane is a node of a
  // `@studio/…-track` module and vets exactly like one. There is no `tracks/` branch: the folder
  // is gone. See docs/trackModules.md.
  if (inFolder("nodes")) return parseModule;
  if (inFolder("clips")) return against(ClipSchema);
  if (inFolder("sequences")) return against(SequenceSchema);
  if (inFolder("curves")) return against(CurveSchema);
  if (inFolder("video_tracks")) return against(VideoTrackSchema);
  if (inFolder(VIEWS_DIR) && base === MIX_VIEW_BASE) return parseMixView;
  if (base === "chains") return parseChains;
  if (base === "project") return against(ProjectFileSchema);
  if (base === "songs") return parseSongs;
  return null;
}

/** The YAML parser's own complaints — the text does not parse at all. */
function syntaxIssues(text: string): ModuleIssue[] {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
  return doc.errors.map((e) => {
    const pos = lines.linePos(e.pos[0]);
    return { path: "", message: e.message, line: pos.line, col: pos.col };
  });
}

/**
 * Is `text` a document the compiler could read as the file at `path`?
 *
 * Syntax is checked FIRST and separately — parsing the text twice, which costs nothing at these
 * sizes — because "does not parse" and "parses but says something the schema refuses" are
 * different answers to a caller deciding whether to write the file.
 */
export function validateFile(path: string, text: string): Validity {
  if (!YAML_EXT.test(path))
    return { ok: true, issues: [], depth: "none", malformed: false };
  const syntax = syntaxIssues(text);
  if (syntax.length)
    return { ok: false, issues: syntax, depth: "syntax", malformed: true };
  const parse = parserFor(path);
  if (!parse)
    return { ok: true, issues: [], depth: "syntax", malformed: false };
  const { issues } = parse(text);
  return { ok: !issues.length, issues, depth: "schema", malformed: false };
}

/** The first thing wrong, phrased for a status line. Null when nothing is. */
export function firstIssue(v: Validity): string | null {
  const i = v.issues[0];
  if (!i) return null;
  const where = i.line ? `l.${i.line}${i.col ? `:${i.col}` : ""} ` : "";
  return `${where}${i.path ? `${i.path}: ` : ""}${i.message}`;
}
