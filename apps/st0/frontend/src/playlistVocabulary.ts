// playlistVocabulary.ts — what may be written in a playlist file, from the songs the library
// actually holds. Its own adapter and not `schemaVocabulary`, which answers for a st0 PROJECT
// and rightly says nothing about a médiathèque file. Pure. See ../docs/completion.md.

import { songRef } from "@studio/mediatek/playlistItems";
import type { MediatekEntry } from "@studio/mediatek/types";
import type { YamlVocabulary } from "@studio/ui-editor/yaml/completions";

/** The two fields `parsePlaylist` reads at the top level, and the two an item may carry. */
const FILE_FIELDS = ["title", "items"];
const ITEM_FIELDS = ["song", "variant"];

/** The library's songs as playlist refs — the unambiguous form, and the same one the search writes; `findSong` still reads a bare name. */
const refsOf = (songs: MediatekEntry[]): string[] =>
  [...new Set(songs.map(songRef))].sort();

/** Every variant name in the library, deduplicated: a vocabulary is asked about a POSITION and has never seen the `song:` above it. */
const variantsOf = (songs: MediatekEntry[]): string[] =>
  [
    ...new Set(songs.flatMap((s) => (s.variants ?? []).map((v) => v.name))),
  ].sort();

/** The vocabulary for a playlist, over a songs listing — `songs` may be null on the first frame, and offering nothing then is honest. */
export function playlistVocabulary(
  songs: MediatekEntry[] | null,
): YamlVocabulary {
  const refs = songs ? refsOf(songs) : [];
  const variants = songs ? variantsOf(songs) : [];
  return {
    fieldsAt: (path) => {
      if (path.length === 0) return FILE_FIELDS;
      // A `- ` under `items:` may be a mapping, so these are offered beside the refs: until the colon is typed the line is genuinely both.
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
