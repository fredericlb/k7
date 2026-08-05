// projects.ts — which studio app owns a project folder, decided by the folder's NAME.
// `mysong.l8` opens in l8, `myset.m9` opens in m9. Stated once, browser-safe and with no
// imports, because st0 reads it out of a git tree, the file service reads it off a disk and
// both SPAs draw it. See apps/st0/docs/projects.md.

import type { StudioService } from "./services.ts";

/** The apps a project folder can belong to. A subset of the services: k7 and z0 own no projects. */
export type ProjectApp = Extract<StudioService, "l8" | "m9">;

/** The suffix each app claims, longest-first is irrelevant here — they are the same length. */
export const PROJECT_SUFFIXES: Record<ProjectApp, string> = {
  l8: ".l8",
  m9: ".m9",
};

/**
 * The app that opens a folder with this name, or null when the name claims none.
 *
 * The NAME, not the contents. That is what lets st0 answer the question from a git tree it
 * has never checked out — a bare blobless mirror has every path and no file bodies, so any
 * rule that opened a file could not run there at all. See packages/git-repos/docs/mirror.md.
 *
 * A `project.yaml` is still what makes a project COMPILE, and `@studio/song` still asks that
 * question its own way. These two are not the same question: one is "who opens this", the
 * other is "can the engine be given it".
 */
export function projectApp(name: string): ProjectApp | null {
  for (const [app, suffix] of Object.entries(PROJECT_SUFFIXES))
    if (name.length > suffix.length && name.endsWith(suffix))
      return app as ProjectApp;
  return null;
}

/** The folder name with its suffix taken off — what a project is CALLED. */
export function projectLabel(name: string): string {
  const app = projectApp(name);
  return app ? name.slice(0, -PROJECT_SUFFIXES[app].length) : name;
}
