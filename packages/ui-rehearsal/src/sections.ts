// sections.ts — the rehearsal pages' entries, as a host's sidebar draws them: which path each opens
// and which one an address belongs to. A recording's and a moment's pages have no entry here: they
// belong to the host's recordings, which the address says as `recordings` (../docs/sections.md).

import { type LucideIcon, Radio, Target } from "@frediverse/ui/icons";
import { withinPrefix } from "./host";
import { m } from "./paraglide/messages.js";
import type { NavKey } from "./types";

export interface RehearsalSection {
  id: NavKey;
  /** The path below the prefix the entry opens. */
  path: string;
  icon: LucideIcon;
  /** Read at call time, so it follows the locale. */
  label: () => string;
}

// Glyphs the media library's entries do not use: the host draws both groups in one rail.
export const REHEARSAL_SECTIONS: readonly RehearsalSection[] = [
  {
    id: "publications",
    path: "/releases",
    icon: Radio,
    label: () => m["nav.publications"](),
  },
  {
    id: "exercises",
    path: "/exercises",
    icon: Target,
    label: () => m["nav.exercices"](),
  },
];

/** The entry an address belongs to, or null when it is not under the prefix. */
export function rehearsalSectionAt(
  pathname: string,
  prefix: string,
): NavKey | null {
  const rest = withinPrefix(pathname, prefix);
  if (rest === null) return null;
  const seg = rest.split("/")[1] ?? "";
  if (seg === "releases" || seg === "pages") return "publications";
  // `exercices` is the French spelling an older address may still carry; RehearsalRoutes redirects it.
  if (seg === "exercises" || seg === "exercices") return "exercises";
  // A recording, a session, a moment and the bare prefix: the host's recordings, which no entry here draws.
  return "recordings";
}
