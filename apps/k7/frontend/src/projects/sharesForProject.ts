// sharesForProject.ts — which shares came out of THIS project. `origin` is written by the file service
// as two basenames, not as a project's portable address, and that asymmetry is what the page must
// cross to put a button on a row. Named at length rather than "projectShares": on Windows it would
// collide with ProjectShares.tsx, whose case vite's resolver ignores.
// See ../../docs/projects.md, § « Les partages ».

import type { ShareSummary } from "@studio/web-protocol";

/** The name a project appears under in `origin.project` — the LAST segment with its suffix, `"."` meaning a project that IS its workspace. */
export function shareProjectName(
  workspaceName: string,
  projectPath: string,
): string {
  if (projectPath === "." || projectPath === "")
    return workspaceName.split("/").pop() ?? workspaceName;
  return projectPath.split("/").pop() ?? projectPath;
}

/** This project's shares, revoked ones included — two projects of the same name in one workspace are indistinguishable, `origin` carrying a basename. */
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
