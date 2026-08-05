// songsFile.ts — read songs.yaml: parse, validate, and hand back the set's refs deduplicated
// and sorted. Browser-safe (no fs), because the app that DRAWS a set list is the one that
// needs it. Full rationale: docs/songsFile.md.

import { LineCounter, parseDocument } from "yaml";
import { songIdOf } from "../songRef";
import type { ModuleIssue } from "./moduleFile";
import { type SongsFile, SongsFileSchema } from "./songsSchema";

// YAML 1.2 for the reason every other file here pins it (moduleFile.ts): a scalar shaped like
// `5:1:1` stays a string. A ref carries no colon today, and the day one does it must not
// silently become a number.
const OPTS = { version: "1.2" as const };

export interface ParsedSongs {
  value: SongsFile | null;
  issues: ModuleIssue[];
}

export function parseSongs(text: string): ParsedSongs {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };

  const raw = doc.toJS() ?? {};
  // A bare sequence at the root — `- "@mediatek/songs/…"` with no `songs:` key. Named
  // precisely rather than reported as "expected object": it is the first thing anyone writes,
  // and the fix is one line.
  if (Array.isArray(raw))
    return {
      value: null,
      issues: [
        {
          path: "",
          message:
            "songs.yaml is a mapping with a `songs:` key, not a bare list — indent the " +
            "entries under `songs:`.",
        },
      ],
    };

  const result = SongsFileSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const keys = (issue as { keys?: string[] }).keys;
      const path = [...issue.path, ...(keys?.length ? [keys[0]] : [])];
      issues.push({ path: path.map(String).join("."), message: issue.message });
    }
    return { value: null, issues };
  }
  return { value: result.data, issues: [] };
}

/**
 * The set's songs: every ref it names, deduplicated and SORTED.
 *
 * Sorted because the list is unordered and something has to decide what a surface draws
 * first; doing it here rather than in each surface is what stops two screens showing the
 * same set in two orders. The file's own line order is therefore not meaningful, which is
 * the point — a set list's running order is decided at the desk, not in git.
 */
export function songRefs(file: SongsFile | null | undefined): string[] {
  return [...new Set(file?.songs ?? [])].sort();
}

/** The médiathèque ids a set names — the refs with their `@mediatek/` taken off. */
export function songIds(file: SongsFile | null | undefined): string[] {
  return songRefs(file)
    .map(songIdOf)
    .filter((id): id is string => !!id);
}
