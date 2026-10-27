// identifySong.ts — what "Add a song" makes of the recording MusicBrainz (or Deezer) names for the
// artist and title typed: the same song, another one, or none. Pure, so tested without a server.
// The typed names always decide the folder; the identified tags only steer the search — ../docs/hunt.md.

import { sameSong } from "@studio/mediatek/songMatch";
import type { HuntFileAs, HuntTags } from "@studio/web-protocol/hunt";

/** The identification, judged against the names typed. */
export type Identified =
  | { kind: "same"; tags: HuntTags }
  | { kind: "other"; tags: HuntTags }
  | { kind: "none" };

/** Is what was identified the song named? The songbook's own rule, `sameSong`. */
export function judge(names: HuntFileAs, tags: HuntTags | null): Identified {
  if (!tags) return { kind: "none" };
  return sameSong(names.artist, names.title, tags.artist, tags.title)
    ? { kind: "same", tags }
    : { kind: "other", tags };
}

/** What `POST /api/hunt` is sent once the hunt is wanted: the recording to search, the names to file under. */
export function huntRequest(
  names: HuntFileAs,
  identified: Identified,
): { query: string; tags: HuntTags; fileAs: HuntFileAs } {
  const query = `${names.artist} ${names.title}`;
  // Nothing identified: the typed names are searched as they are, as the user asked.
  const tags =
    identified.kind === "none"
      ? { ...names, album: null, date: null }
      : identified.tags;
  return { query, tags, fileAs: names };
}

/** The identified recording in one line: artist, title, then its album and year when known. */
export function describeTags(tags: HuntTags): string {
  const year = tags.date?.slice(0, 4);
  const record = [tags.album, year].filter(Boolean).join(", ");
  return `${tags.artist} — ${tags.title}${record ? ` (${record})` : ""}`;
}
