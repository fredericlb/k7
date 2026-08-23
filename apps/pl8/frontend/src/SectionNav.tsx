// SectionNav.tsx — pl8's sections as `AppHeaderItem`s: the tab strip and the hamburger are
// @frediverse/ui's, this list is pl8's. Each section's count rides the item's `trailing`.
// See ../docs/responsive.md.

import type { AppHeaderItem } from "@frediverse/ui/app-header";
import { RECORDINGS_DIR } from "@studio/mediatek/types";
import { Disc3, type LucideIcon, Mic, Waves } from "lucide-react";
import type { SectionId } from "./routes";

/**
 * The sections: the three families, plus the raw captures zone.
 *
 * THREE left together, for one reason: they were about WRITING, and writing happens in st0.
 * Modules and chains went with the editing — a module is authored against a project where the
 * plugin it names is actually LOADED. Projects led the way and the app used to start there; the
 * repositories are st0's home page now, that being the level above a project.
 *
 * RECORDINGS is not a family either — a root folder with no catalogue entry and no listing to
 * ask `/list` for. It is here because the screen is organised by what you are looking at.
 * See packages/mediatek/docs/recordings.md and apps/st0/frontend/docs/projects.md.
 */
export const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "songs", label: "Morceaux", icon: Disc3 },
  { id: "samples", label: "Samples", icon: Waves },
  { id: RECORDINGS_DIR, label: "Enregistrements", icon: Mic },
];

/**
 * The sections, in the shape the shared bar consumes.
 *
 * The COUNT goes on `trailing` rather than into the label: the label is the string the menu ticks
 * and `aria-current` announces, and a number folded into it would read as part of the page's name
 * and change whenever the catalogue does.
 *
 * A function and not an array: `counts` and `section` change, the list does not.
 */
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

/** The name of the section you are in — the bar's subtitle. A hamburger alone does not say where
 *  you are, which is the first thing a phone screen is asked. */
export const sectionLabel = (section: SectionId): string | undefined =>
  SECTIONS.find((s) => s.id === section)?.label;
