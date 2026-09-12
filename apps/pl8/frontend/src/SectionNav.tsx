// SectionNav.tsx — pl8's sections as `AppHeaderItem`s: the tab strip and the hamburger are
// @frediverse/ui's, this list is pl8's. Each section's count rides the item's `trailing`.
// See ../docs/responsive.md.

import type { AppHeaderItem } from "@frediverse/ui/app-header";
import { PLAYLISTS_DIR, RECORDINGS_DIR } from "@studio/mediatek/types";
import { Disc3, ListMusic, type LucideIcon, Mic, Waves } from "lucide-react";
import type { SectionId } from "./routes";

/** The two families plus the two root zones, which are not families (../docs/routing.md). */
export const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "songs", label: "Morceaux", icon: Disc3 },
  { id: "samples", label: "Samples", icon: Waves },
  { id: RECORDINGS_DIR, label: "Enregistrements", icon: Mic },
  { id: PLAYLISTS_DIR, label: "Playlists", icon: ListMusic },
];

/** The sections as the shared bar consumes them, count on `trailing` (../docs/responsive.md). */
export function sectionItems(
  section: SectionId,
  counts: Partial<Record<string, number>>,
  onPick: (id: SectionId) => void,
): AppHeaderItem[] {
  return SECTIONS.map(({ id, label, icon: Icon }) => ({
    label,
    icon: <Icon className="h-4 w-4 shrink-0" />,
    active: section === id,
    onClick: () => onPick(id),
    trailing: (
      <span
        className={`shrink-0 tabular-nums text-xs ${
          section === id ? "" : "text-muted-foreground"
        }`}
      >
        {counts[id] ?? 0}
      </span>
    ),
  }));
}

/** The name of the section you are in: a hamburger alone does not say where you are. */
export const sectionLabel = (section: SectionId): string | undefined =>
  SECTIONS.find((s) => s.id === section)?.label;
