// launch.ts — which project this editor was opened on. The address says so, and nothing
// else does: `/l8/<repo>/<project>`. The parsing itself lives in
// @studio/web-protocol/projects, beside the suffix rule it depends on, because st0 WRITES
// these addresses and l8/m9 READ them — that makes it a wire contract, not an app's habit.
// This module is what the two apps import. See docs/launch.md.

import { serviceUrl } from "@studio/web-protocol/services";

export type { Launch } from "@studio/web-protocol/projects";
export {
  launchUrl,
  parseLaunch,
  projectApp,
  projectBasename,
  projectClaimKey,
} from "@studio/web-protocol/projects";

/**
 * Where projects are chosen: **l8's home page** — the address that names no project.
 *
 * It was st0's `/projects` for as long as the médiathèque owned the level above a project. It
 * does not any more: the repositories, the libraries, the deploy key and the shares are all
 * drawn by l8 now, and st0 is the catalogue a project draws ON. What did NOT move is who
 * stores any of it — every route this screen calls is still st0's, and every working copy is
 * still the engine machine's. See apps/l8/frontend/docs/projects.md.
 *
 * Still ONE address for both apps. z0's editor comes back here too: this is the list that holds
 * `.z0` folders as well, and a second picker of its own is the second thing to keep in step
 * that this package exists to prevent.
 *
 * The trailing slash is `BASE_URL`'s own spelling, so the tab lands on the app's mount rather
 * than on a redirect to it.
 */
export function projectsUrl(origin: string): string {
  return `${serviceUrl(origin, "l8")}/`;
}
