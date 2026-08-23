// sharesForProject.ts — which shares came out of THIS project. `origin` is written by the machine
// as two basenames, not as a project's portable address, and that asymmetry is what the page must
// cross to put a button on a row. Named at length rather than "projectShares": on Windows it would
// collide with ProjectShares.tsx, whose case vite's resolver ignores.
// See ../../docs/projects.md, § « Les partages ».

import type { ShareSummary } from "@studio/web-protocol";

/**
 * The name a project appears under in `origin.project`.
 *
 * The file service writes `origin: { repo: basename(root), project: basename(dir) }`
 * (`packages/file-service/src/workspace.ts`, `shareLink`): the LAST segment with its suffix, never
 * the full path. A project that IS its workspace has `dir === root`, so the workspace name on both
 * sides — which is what `"."` means here.
 */
export function shareProjectName(
  workspaceName: string,
  projectPath: string,
): string {
  if (projectPath === "." || projectPath === "")
    return workspaceName.split("/").pop() ?? workspaceName;
  return projectPath.split("/").pop() ?? projectPath;
}

/**
 * This project's shares, revoked ones included.
 *
 * The revoked stay: the dated row is what answers "yes, it existed and it is withdrawn", and
 * removing it from the only screen that shows it leaves its author wondering.
 *
 * **Two projects of the same name in two folders of one workspace are indistinguishable**, because
 * `origin` carries only a basename. They see the same rows. Widening the comparison would need the
 * machine to write the path, which is settled there and not here.
 */
export function sharesOf(
  shares: ShareSummary[],
  workspaceName: string,
  projectPath: string,
): ShareSummary[] {
  const name = shareProjectName(workspaceName, projectPath);
  return shares.filter(
    (s) => s.origin.repo === workspaceName && s.origin.project === name,
  );
}

/** What the button shows: the LIVE shares, the only ones costing bytes. */
export const liveCount = (shares: ShareSummary[]): number =>
  shares.filter((s) => !s.revokedAt).length;
