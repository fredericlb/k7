import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { playlistVocabulary } from "./playlistVocabulary";

const song = (path: string, variants?: string[]): MediatekEntry =>
  ({
    family: "songs",
    id: path,
    name: path.split("/").pop() ?? path,
    path,
    kind: "",
    mtime: 0,
    ...(variants
      ? {
          variants: variants.map((name) => ({
            name,
            ref: `${name}.mp3`,
            kind: "file" as const,
          })),
        }
      : {}),
  }) as MediatekEntry;

const SONGS = [
  song("songs/AC-DC/Back in Black/Hells Bells", ["live"]),
  song("songs/Nirvana/Nevermind/Lithium", ["live", "acoustic"]),
];

const vocab = playlistVocabulary(SONGS);
const values = (path: string[], field: string) =>
  vocab.valuesAt?.(path, field) ?? [];

describe("the playlist vocabulary", () => {
  it("offers the file's own two fields", () => {
    expect(vocab.fieldsAt([])).toEqual(["title", "items"]);
  });

  it("offers a song ref for a bare `- ` item", () => {
    // The common line, and the one that had no completion: `items:` is not a project file's field, so the whole file went uncovered.
    expect(values([], "items")).toEqual([
      "AC-DC/Back in Black/Hells Bells",
      "Nirvana/Nevermind/Lithium",
    ]);
  });

  it("offers the item's fields on that same line", () => {
    // `- song: x` is as legal as `- x`, and nothing on the line has decided which yet.
    expect(vocab.fieldsAt(["items"])).toEqual(["song", "variant"]);
  });

  it("offers the refs under `song:` too", () => {
    expect(values(["items"], "song")).toContain("Nirvana/Nevermind/Lithium");
  });

  it("offers every variant name once, under `variant:`", () => {
    // The union across the library: a vocabulary is asked about a POSITION and has never seen the `song:` on the line above.
    expect(values(["items"], "variant")).toEqual(["acoustic", "live"]);
  });

  it("says nothing where the value is free text", () => {
    expect(values([], "title")).toEqual([]);
    expect(values(["items"], "colour")).toEqual([]);
    expect(vocab.fieldsAt(["items", "song"])).toEqual([]);
  });

  it("says nothing before the listing arrives, rather than guessing", () => {
    // It is polled beside the file: on the first frame there is no answer, and one poll later there is.
    const empty = playlistVocabulary(null);
    expect(empty.valuesAt?.([], "items")).toEqual([]);
    // …the file's shape is known from the schema either way.
    expect(empty.fieldsAt([])).toEqual(["title", "items"]);
  });
});
