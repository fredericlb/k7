// projectName.ts — the folder name a new project will carry. Pure, and kept apart, because that
// name is not a label: the SUFFIX is what decides which application opens it.
// See packages/web-protocol/projects.ts and ../../docs/projects.md.

import {
  PROJECT_SUFFIXES,
  type ProjectApp,
} from "@studio/web-protocol/projects";

export interface ProjectName {
  /** The folder as it will be created, or "" when the name will not do. */
  folder: string;
  /** Why it will not do, or "". */
  error: string;
}

const SUFFIXES = Object.values(PROJECT_SUFFIXES);

/** The folder to create, shown BEFORE creating: separators are REFUSED rather than replaced, and a suffix already typed is stripped. */
export function projectFolderName(raw: string, app: ProjectApp): ProjectName {
  const { folder: stem, error } = workspaceFolderName(raw);
  if (error) return { folder: "", error };
  return { folder: `${stem}${PROJECT_SUFFIXES[app]}`, error: "" };
}

/**
 * The same name rules, with NO suffix on the end — a workspace is a plain folder, and the
 * suffix is what decides which app opens a PROJECT. Shared so the two dialogs refuse the same
 * things in the same words.
 */
export function workspaceFolderName(raw: string): ProjectName {
  const name = raw.trim();
  if (!name) return { folder: "", error: "il faut un nom" };
  if (/[/\\]/.test(name))
    return {
      folder: "",
      error: "pas de « / » ni de « \\ » dans un nom",
    };
  // A name starting with a dot is a hidden folder: it would exist unseen, here and in the repository's tree alike.
  if (name.startsWith("."))
    return { folder: "", error: "un nom ne peut pas commencer par un point" };
  const stem = SUFFIXES.reduce(
    (s, suffix) =>
      s.length > suffix.length && s.toLowerCase().endsWith(suffix)
        ? s.slice(0, -suffix.length)
        : s,
    name,
  );
  if (!stem) return { folder: "", error: "il faut un nom" };
  return { folder: stem, error: "" };
}
