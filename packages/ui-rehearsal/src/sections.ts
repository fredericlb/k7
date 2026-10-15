// sections.ts — the rehearsal pages' entries, as a host's sidebar draws them: which path each opens
// and which one an address belongs to. Releases and pages are ONE entry, sessions and moments another.

import {
  BookOpen,
  Disc3,
  type LucideIcon,
  Mic,
  Target,
} from "@frediverse/ui/icons";
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

export const REHEARSAL_SECTIONS: readonly RehearsalSection[] = [
  {
    id: "recordings",
    path: "/sessions",
    icon: Mic,
    label: () => m["nav.recordings"](),
  },
  {
    id: "publications",
    path: "/releases",
    icon: Disc3,
    label: () => m["nav.publications"](),
  },
  {
    id: "songbook",
    path: "/songs",
    icon: BookOpen,
    label: () => m["nav.songbook"](),
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
  if (seg === "songs") return "songbook";
  // `exercices` is the French spelling an older address may still carry; RehearsalRoutes redirects it.
  if (seg === "exercises" || seg === "exercices") return "exercises";
  // sessions, moments and the bare prefix all land on Recordings.
  return "recordings";
}

/** One song's own page: the songbook list and the creation form are not it. */
export function isSongPage(pathname: string, prefix: string): boolean {
  const rest = withinPrefix(pathname, prefix);
  return rest !== null && /^\/songs\/(?!new$)[^/]+$/.test(rest);
}
