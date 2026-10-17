// sections.ts — the media library's sections as a host draws them in its own nav: the two families,
// the two root zones and the hunt, each with its glyph and the address it opens.
// The one thing a reader would get wrong: `counted` sections show a count, the hunt has none to show.

import {
  AudioWaveform,
  Disc3,
  ListMusic,
  type LucideIcon,
  Search,
  Waves,
} from "@frediverse/ui/icons";
import type { LibraryLabels } from "./labels";
import { fromLocation, type SectionId, toPath } from "./routes";

export interface LibrarySection {
  id: SectionId;
  icon: LucideIcon;
  /** Whether the volume's summary counts it — a family or a zone does, the hunt does not. */
  counted: boolean;
}

// Each glyph is unique in the host's sidebar, rehearsal's entries included: on the icon rail it is all there is.
export const LIBRARY_SECTIONS: LibrarySection[] = [
  { id: "songs", icon: Disc3, counted: true },
  { id: "samples", icon: Waves, counted: true },
  { id: "recordings", icon: AudioWaveform, counted: true },
  { id: "playlists", icon: ListMusic, counted: true },
  { id: "find", icon: Search, counted: false },
];

/** A section's name, in the host's words. */
export const sectionLabel = (labels: LibraryLabels, id: SectionId): string =>
  labels.sections[id];

/** Where a section opens, under the host's prefix. */
export const sectionPath = (id: SectionId, prefix: string): string =>
  toPath({ section: id, file: null }, prefix);

/** The section an address under `prefix` shows — the bare prefix being the default one. */
export const sectionAt = (pathname: string, prefix: string): SectionId =>
  fromLocation(pathname, prefix).section;
