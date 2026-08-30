// launch.ts — which project this editor is open on. The address says so, and nothing
// else does: `/<repo>/<project>` (st0 answers the origin root). The parsing itself lives in
// @studio/web-protocol/projects, beside the suffix rule it depends on, because st0's home page
// WRITES these addresses and both editors READ them — a wire contract, not an app's habit.
// This module is what the two apps import. See docs/launch.md.

import { serviceUrl } from "@studio/web-protocol/services";

export type { Launch } from "@studio/web-protocol/projects";
export {
  EXTERNAL_INDEX,
  EXTERNAL_SEGMENT,
  externalIndexUrl,
  externalOf,
  externalUrl,
  isExternalIndex,
  isSettings,
  isTabs,
  launchUrl,
  parseExternal,
  parseLaunch,
  projectApp,
  projectBasename,
  projectClaimKey,
} from "@studio/web-protocol/projects";

/** Where projects are chosen: st0's home page, ONE address for every app — see docs/launch.md. */
export function projectsUrl(origin: string): string {
  return `${serviceUrl(origin, "st0")}/`;
}
