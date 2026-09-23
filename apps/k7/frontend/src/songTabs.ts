// Which kinds of content a song page shows as tabs: the ones the song holds, plus the one being added.
// A tab bar for a single kind is noise, so the view draws it only from two tabs up.

import { m } from "./paraglide/messages.js";
import type { Song, SongTab } from "./types";

export const SONG_TABS: { key: SongTab; label: () => string }[] = [
  { key: "lyrics", label: m["song.tab.lyrics"] },
  { key: "tablature", label: m["song.tab.tablatureFull"] },
  { key: "sheet", label: m["song.tab.sheet"] },
];

/** Whether a kind holds anything: lyrics and tablature are text, the sheet is a file list. */
export const hasContent = (song: Song, key: SongTab): boolean =>
  key === "sheet" ? song.sheets.length > 0 : song[key].trim() !== "";

/** The tabs to show, in their fixed order: what the song holds, and the kind being added if any. */
export function visibleTabs(song: Song, adding: SongTab | null): SongTab[] {
  return SONG_TABS.map(({ key }) => key).filter(
    (key) => key === adding || hasContent(song, key),
  );
}

/** The kinds the song does not show yet — what the add links offer. */
export function missingTabs(song: Song, adding: SongTab | null): SongTab[] {
  const shown = visibleTabs(song, adding);
  return SONG_TABS.map(({ key }) => key).filter((key) => !shown.includes(key));
}
