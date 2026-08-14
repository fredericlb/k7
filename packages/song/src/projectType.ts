// projectType.ts — which dialect a project folder is — l8 or z0 — and what to do when the
// folder's NAME and its `project.yaml` disagree. The suffix decides; the file is checked
// against it and never overrules it. Full rationale: docs/setProject.md.

import { basename } from "node:path";
import { projectApp } from "@studio/web-protocol/projects";
import { type Diagnostic, loadProjectRoot } from "./loader";
import { entityFileFor } from "./yaml/moduleIO";
import type { ProjectType } from "./yaml/projectSchema";

export type { ProjectType };

/** What `project.yaml` says it is, or null when it says nothing — which is most songs. */
export function declaredType(dir: string): ProjectType | null {
  try {
    return (loadProjectRoot(dir).type as ProjectType | undefined) ?? null;
  } catch {
    return null; // an unreadable header is the compile's error, not this
  }
}

/**
 * The dialect of the folder at `dir`.
 *
 * Three steps, and their ORDER is the whole design:
 *
 * 1. The folder's **suffix**, when it has one. `@studio/web-protocol/projects` already
 *    decides from the name which app opens a link, and st0 answers that question from a
 *    blobless git mirror that has every path and no file bodies — so the name is the one
 *    signal available everywhere. A second authority that could disagree with it would put
 *    the app that OPENED the folder at odds with the loader reading it.
 * 2. Failing that, what the **file** declares. A repository can BE the project (`"."` — see
 *    project-shell's launch.md), and then there is no suffix to read at all. This is the case
 *    `type:` exists for.
 * 3. Failing both, **l8** — what a folder saying nothing is, and most say nothing.
 *
 * The dialects are `ProjectApp`'s members, not a list of its own: step 1 already answers with
 * `projectApp`, so a second list could only ever disagree with the first. See projectSchema.
 */
export function projectTypeOf(dir: string): ProjectType {
  return projectApp(basename(dir)) ?? declaredType(dir) ?? "l8";
}

/**
 * The contradiction between the folder's name and its own declaration, if there is one.
 *
 * Reported and not thrown, and not silently resolved either: a `quiz.z0` that declares
 * `type: l8` opens in z0 whatever the file says, so the declaration is a lie a reader will
 * believe — and the fix is one word, on a line this names. This is the same job
 * `deadProjectFields` does for a field nothing reads: stop "accepted" from meaning "silently
 * ignored", which is the failure mode this codebase keeps paying for.
 */
export function projectTypeIssues(dir: string): Diagnostic[] {
  const suffix = projectApp(basename(dir));
  const declared = declaredType(dir);
  if (!suffix || !declared || suffix === declared) return [];
  // Project-RELATIVE, like every other Diagnostic — the editor matches these against its tree.
  const file = (
    entityFileFor(dir, "", "project")?.rel ?? "project.yaml"
  ).replace(/^\/+/, "");
  return [
    {
      file,
      line: 1,
      col: 1,
      severity: "error",
      message: `this folder is named \`.${suffix}\` but declares \`type: ${declared}\` — the NAME decides which app opens it, so ${declared} will never be given this project. Change the declaration to \`${suffix}\`, or rename the folder.`,
    },
  ];
}
