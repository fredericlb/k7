// The one-shot move of a song's facts from song.yaml into its master: the tags land first, the
// sidecar loses its copy only then, and a master TagLib cannot write keeps its sidecar whole.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMasterTags, writeMasterTags } from "../src/tags.ts";
import { tinyWav } from "../src/testWav.ts";
import {
  migrateSongFolder,
  sidecarFolders,
  stripMoved,
} from "./migrateSongTags.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "migrate-tags-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const OLD = `# L'arborescence est déduite de ces trois champs — la renommer ici ne déplace rien.
# Voir packages/mediatek/docs/songs.md.
title: "So What"
artist: "Miles Davis"
album: "Kind of Blue"
source: "upload"
bpm: 136
key: "D minor"
variants:
  instrumental: instrumental.wav
`;

function song(
  rel: string,
  sidecar: string,
  master: Buffer | string = tinyWav(),
) {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "song.yaml"), sidecar);
  writeFileSync(join(dir, "original.wav"), master);
  return dir;
}

describe("migrating a song", () => {
  it("tags the master with the sidecar's fields, then strips them", async () => {
    const dir = song("songs/Miles Davis/Kind of Blue/So What", OLD);
    expect((await migrateSongFolder(dir)).kind).toBe("migrated");
    expect(await readMasterTags(join(dir, "original.wav"))).toEqual({
      title: "So What",
      artist: "Miles Davis",
      album: "Kind of Blue",
      bpm: 136,
      key: "D minor",
    });
    const after = readFileSync(join(dir, "song.yaml"), "utf8");
    expect(after).toBe(
      `# Title, artist, album, tempo and key live in the master's tags — see packages/mediatek/docs/songs.md.
source: "upload"
variants:
  instrumental: instrumental.wav
`,
    );
  });

  it("lets the sidecar win over a tag the file already carried", async () => {
    const dir = song("songs/A/B/C", 'title: "From YAML"\n');
    await writeMasterTags(join(dir, "original.wav"), {
      title: "From file",
      album: "Kept",
    });
    await migrateSongFolder(dir);
    expect(await readMasterTags(join(dir, "original.wav"))).toEqual({
      title: "From YAML",
      album: "Kept",
    });
  });

  it("keeps the sidecar whole when the master cannot be tagged", async () => {
    const dir = song("songs/A/B/C", OLD, "not audio");
    const r = await migrateSongFolder(dir);
    expect(r.kind).toBe("untaggable");
    expect(readFileSync(join(dir, "song.yaml"), "utf8")).toBe(OLD);
  });

  it("writes nothing on a dry run", async () => {
    const dir = song("songs/A/B/C", OLD);
    const r = await migrateSongFolder(dir, true);
    expect(r).toMatchObject({ kind: "migrated", tags: { title: "So What" } });
    expect(readFileSync(join(dir, "song.yaml"), "utf8")).toBe(OLD);
    expect(await readMasterTags(join(dir, "original.wav"))).toEqual({});
  });

  it("leaves a sidecar with nothing to move exactly as it is", async () => {
    const dir = song("songs/A/B/C", 'source: "k7"\n');
    expect((await migrateSongFolder(dir)).kind).toBe("nothing");
    expect(readFileSync(join(dir, "song.yaml"), "utf8")).toBe('source: "k7"\n');
  });

  it("finds every sidecar under songs/, the K7 releases included", () => {
    song("songs/A/B/C", OLD);
    song("songs/K7/Release (abc)/Version (def)", OLD);
    expect(sidecarFolders(root).map((d) => d.slice(root.length + 1))).toEqual([
      "songs/A/B/C",
      "songs/K7/Release (abc)/Version (def)",
    ]);
  });
});

describe("stripMoved", () => {
  it("drops a moved key's wrapped value with it, and nothing under variants", () => {
    expect(
      stripMoved("title: >\n  a long\n  title\nvariants:\n  title: t.wav\n"),
    ).toBe(
      "# Title, artist, album, tempo and key live in the master's tags — see packages/mediatek/docs/songs.md.\nvariants:\n  title: t.wav\n",
    );
  });
});
