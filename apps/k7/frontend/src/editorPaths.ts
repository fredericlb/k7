// editorPaths.ts — what the editor pane asks of a path or a file's text: which files the tree can
// open, where a gutter's source resolves, what a clip or a sequence names. Pure, so EditorTab.tsx
// keeps only the pane.

import { VIDEO_SOURCE } from "@studio/song-schema/yaml/entitySchemas";
import {
  isRackModuleFile,
  readScalarField,
  toProjectRelative,
} from "./projectPaths";
import type { FileNode, WebProject } from "./types";

// Flatten the tree to openable text paths — binaries can't be shown, which also drops .dawproject archives.
export function textFiles(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FileNode[]): void => {
    for (const n of ns) {
      if (n.dir) {
        if (n.children) walk(n.children);
      } else if (n.kind !== "binary") out.push(n.path);
    }
  };
  walk(nodes);
  return out;
}

// EVERY path the tree holds, folders included and binaries kept — what a `file …` command may name; `textFiles` is the narrower list.
export function allEntries(
  nodes: FileNode[],
): { path: string; dir: boolean }[] {
  const out: { path: string; dir: boolean }[] = [];
  const walk = (ns: FileNode[]): void => {
    for (const n of ns) {
      out.push({ path: n.path, dir: !!n.dir });
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// Resolve a gutter source where the COMPILER puts it: a rack's sits beside its file, a clip's at the project root.
export function resolveGutterSource(
  source: string,
  filePath: string,
  activeProject: string | null,
): string {
  if (!source || /^([A-Za-z]:[\\/]|[\\/])/.test(source)) return source;
  const projRel = toProjectRelative(filePath, activeProject);
  if (!isRackModuleFile(projRel)) return source;
  const slash = projRel.lastIndexOf("/");
  return slash > 0 ? `${projRel.slice(0, slash)}/${source}` : source;
}

// clips/ holds audio and video: the kind comes off the source extension, read with readScalarField so a half-typed file answers.
export const isAudioClipFile = (text: string): boolean => {
  const src = readScalarField(text, "source");
  return !!src && !VIDEO_SOURCE.test(src);
};

// The rack module a sequence names via use_rack, so a slice rack can dock its source waveform.
export const findUseRack = (text: string): string | null =>
  readScalarField(text, "use_rack");

// The grid a clip's window is read and written on, defaulted rather than optional — an edge spelled in SECONDS needs no grid at all.
export const gridOf = (p: WebProject | null | undefined) => ({
  tempo: p?.tempo || 120,
  num: p?.timeSigNumerator || 4,
  den: p?.timeSigDenominator || 4,
});
