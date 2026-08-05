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
} from "@studio/web-protocol/projects";

/** Where projects are chosen: st0's Projets section, which is also its home page. */
export function projectsUrl(origin: string): string {
  return `${serviceUrl(origin, "st0")}/projects`;
}
