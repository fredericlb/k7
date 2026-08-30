// copyProject.ts — copying a project from one workspace into another on this machine. Its own
// module because it is the one act naming TWO workspaces: neither Workspace instance owns it,
// and each end still answers for its own guards. See docs/workspaces.md.

import { slugify } from "./slug.ts";
import { forgetListing, getWorkspace } from "./workspaces.ts";

/** Copy `path` out of workspace `from` into workspace `to`, under the folder name `name`. */
export async function copyProjectBetween(
  userEmail: string,
  from: string,
  path: string,
  to: string,
  name: string,
): Promise<{ project: string }> {
  // Both through getWorkspace, so a workspace that is not there is a 404 rather than an ENOENT.
  const src = getWorkspace(userEmail, from);
  const dest = getWorkspace(userEmail, to);
  const r = await dest.copyProject(src.projectFolder(path), name);
  // The destination gained a project, and the home page's listing is behind a five-second window.
  forgetListing(slugify(userEmail));
  return r;
}
