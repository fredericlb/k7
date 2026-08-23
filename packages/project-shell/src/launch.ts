// launch.ts — which project this editor was opened on. The address says so, and nothing
// else does: `/<repo>/<project>` (st0 answers the origin root). The parsing itself lives in
// @studio/web-protocol/projects, beside the suffix rule it depends on, because pl8 WRITES
// these addresses and st0/m9 READ them — that makes it a wire contract, not an app's habit.
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
