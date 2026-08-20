// playlistVocabulary.ts — what may be written in a playlist file, from the songs the library
// actually holds. Its own adapter and not `schemaVocabulary`, which answers for a st0 PROJECT
// and rightly says nothing about a médiathèque file. Pure. See ../docs/completion.md.

import { songRef } from "@studio/mediatek/playlistItems";
import type { MediatekEntry } from "@studio/mediatek/types";
import type { YamlVocabulary } from "@studio/ui-editor/yaml/completions";

/** The two fields `parsePlaylist` reads at the top level, and the two an item may carry. */
const FILE_FIELDS = ["title", "items"];
const ITEM_FIELDS = ["song", "variant"];

/**
 * The library's songs as playlist refs — their path under `songs/`.
 *
 * The unambiguous form, and the same one the search writes (`songRef`): a pick from a list
 * means THAT morceau, not whatever shares its title. `findSong` reads the bare name too, so a
 * file stays hand-editable either way.
 */
const refsOf = (songs: MediatekEntry[]): string[] =>
  [...new Set(songs.map(songRef))].sort();

/**
 * Every variant name in the library, deduplicated.
 *
 * Across all songs on purpose: a `variant:` belongs to the `song:` on the line above it, and a
 * vocabulary is asked about a POSITION, not about a document — it has never seen that line.
 * The union is still the right list to draw from, since these names repeat by convention
 * ("live", "acoustic") and a wrong one is reported by the pane on the right as soon as it is
 * typed. Narrowing it to the sibling's song would mean parsing the buffer on every keystroke
 * to save a scroll.
 */
const variantsOf = (songs: MediatekEntry[]): string[] =>
  [
    ...new Set(songs.flatMap((s) => (s.variants ?? []).map((v) => v.name))),
  ].sort();

/**
 * The vocabulary for a playlist, over a songs listing.
 *
 * `songs` may be null — the listing is polled beside the file and has not arrived on the first
 * frame. Offering nothing then is the honest answer, and one poll later the list is there.
 */
export function playlistVocabulary(
  songs: MediatekEntry[] | null,
): YamlVocabulary {
  const refs = songs ? refsOf(songs) : [];
  const variants = songs ? variantsOf(songs) : [];
  return {
    fieldsAt: (path) => {
      if (path.length === 0) return FILE_FIELDS;
      // A `- ` under `items:` may be a mapping — `- song: x` with a `variant:` under it —
      // and the completion offers these beside the refs below, because until the colon is
      // typed the line is genuinely both.
      return path.length === 1 && path[0] === "items" ? ITEM_FIELDS : [];
    },
    valuesAt: (path, field) => {
      // The bare form, `- <ref>`: the value belongs to the key that introduced the list.
      if (path.length === 0 && field === "items") return refs;
      if (path.length !== 1 || path[0] !== "items") return [];
      if (field === "song") return refs;
      return field === "variant" ? variants : [];
    },
  };
}
