import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLayout } from "./layout.ts";
import { scanFamily } from "./scan.ts";
import {
  masterName,
  NotAudioError,
  SongExistsError,
  segment,
  songFolder,
  tagsFromFilename,
  VariantRefusedError,
} from "./song.ts";
import { SONG_FILE } from "./types.ts";
import { addSong, addSongVariant, putFile } from "./write.ts";

describe("the deduced tree", () => {
  it("is artiste/album/titre, directly under songs", () => {
    expect(
      songFolder({
        artist: "Miles Davis",
        album: "Kind of Blue",
        title: "So What",
      }),
    ).toBe("songs/Miles Davis/Kind of Blue/So What");
  });

  it("opens no provenance level — three segments, never four", () => {
    // `songs/<imported|recorded>/…` is gone: raw capture is the `recordings/` zone, and
    // what reaches this function is catalogued work whichever surface sent it. The guard is
    // the SEGMENT COUNT, because a fourth level would come back as a nested folder, which
    // an equality check on one example path would not notice.
    const folder = songFolder({
      artist: "K7",
      album: "Sous la pluie",
      title: "Mix final",
    });
    expect(folder).toBe("songs/K7/Sous la pluie/Mix final");
    expect(folder.split("/")).toHaveLength(4); // songs + the three tags
  });

  it("names the hole rather than refusing a file with no album", () => {
    expect(songFolder({ artist: "Miles Davis", title: "So What" })).toBe(
      "songs/Miles Davis/Album inconnu/So What",
    );
    expect(songFolder({})).toBe(
      "songs/Artiste inconnu/Album inconnu/Sans titre",
    );
  });

  it("keeps a tag from becoming a path", () => {
    // The whole point: a client sends tags, never a path. A slash in a title must not open
    // a folder, and `..` must not climb one.
    expect(segment("AC/DC", "x")).toBe("AC DC");
    expect(songFolder({ artist: "../../etc", title: "x" })).toBe(
      "songs/.. .. etc/Album inconnu/x",
    );
  });

  it("drops the accents and keeps the letters under them", () => {
    expect(segment("Café Tacvba", "x")).toBe("Cafe Tacvba");
  });

  it("refuses a name Windows would refuse at rename time", () => {
    expect(segment("Untitled.", "x")).toBe("Untitled");
    expect(segment("   ", "Sans titre")).toBe("Sans titre");
  });
});

describe("the master's name", () => {
  it("keeps the uploaded format — nothing is re-encoded", () => {
    expect(masterName("So What.mp3")).toBe("original.mp3");
    expect(masterName("So What.FLAC")).toBe("original.flac");
  });

  it("refuses what the scan would not see as audio", () => {
    expect(() => masterName("cover.jpg")).toThrow(NotAudioError);
    expect(() => masterName("noext")).toThrow(NotAudioError);
  });
});

describe("guessing from the file name", () => {
  it("reads the convention half a disk follows", () => {
    expect(tagsFromFilename("01 - Miles Davis - So What.mp3")).toEqual({
      artist: "Miles Davis",
      title: "So What",
    });
  });

  it("leaves the artist alone when there is nothing to split on", () => {
    expect(tagsFromFilename("so what.mp3")).toEqual({ title: "so what" });
  });
});

describe("filing an upload", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mediatek-song-"));
    process.env.STUDIO_MEDIATEK = root;
    ensureLayout();
  });
  afterEach(() => {
    delete process.env.STUDIO_MEDIATEK;
    rmSync(root, { recursive: true, force: true });
  });

  const tags = {
    artist: "Miles Davis",
    album: "Kind of Blue",
    title: "So What",
  };
  // A function: `root` is a fresh temp dir per test, so a constant would capture the
  // previous one — or, for the first test, nothing at all.
  const folder = () => join(root, "songs/Miles Davis/Kind of Blue/So What");

  it("creates the tree and the sidecar", () => {
    const r = addSong({
      filename: "whatever.mp3",
      bytes: Buffer.from("ID3"),
      tags,
    });
    expect(r.path).toBe("songs/Miles Davis/Kind of Blue/So What");
    expect(readFileSync(join(folder(), "original.mp3"), "utf8")).toBe("ID3");
    expect(readFileSync(join(folder(), "song.yaml"), "utf8")).toContain(
      'title: "So What"',
    );
  });

  it("files a published version beside every other song, saying who filed it", () => {
    // k7's published versions used to land under `recorded/`, apart from an upload. They
    // land in the same shape now; `source` is what still says where one came from, and it
    // is a line in the sidecar rather than a level in the path.
    const r = addSong({
      filename: "mixdown.mp3",
      bytes: Buffer.from("MIX"),
      tags: {
        artist: "K7",
        album: "Sous la pluie",
        title: "Mix final",
        source: "k7",
      },
    });
    expect(r.master).toBe("songs/K7/Sous la pluie/Mix final/original.mp3");
    const sidecar = readFileSync(join(root, r.path, "song.yaml"), "utf8");
    expect(sidecar).toContain('artist: "K7"');
    expect(sidecar).toContain("source: k7");
    // …and it is a song like any other: the scan lists it.
    const [e] = scanFamily("songs");
    expect(e.meta?.artist).toBe("K7");
  });

  it("lands as one catalogued entry the scan can play", () => {
    addSong({ filename: "x.mp3", bytes: Buffer.from("ID3"), tags });
    const entries = scanFamily("songs");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("So What");
    // "" and not a borrowed word: this family has no subdivision. See MediatekEntry.kind.
    expect(entries[0].kind).toBe("");
    expect(entries[0].meta?.catalogued).toBe(true);
    // Without this the moteur, which opens paths, has nothing to open.
    expect(entries[0].meta?.master).toBe("original.mp3");
  });

  it("refuses to clobber a song already there", () => {
    addSong({ filename: "x.mp3", bytes: Buffer.from("first"), tags });
    expect(() =>
      addSong({ filename: "x.mp3", bytes: Buffer.from("second"), tags }),
    ).toThrow(SongExistsError);
    expect(readFileSync(join(folder(), "original.mp3"), "utf8")).toBe("first");
  });

  it("replaces when told to, leaving ONE master behind", () => {
    addSong({ filename: "x.mp3", bytes: Buffer.from("first"), tags });
    const r = addSong({
      filename: "x.flac",
      bytes: Buffer.from("second"),
      tags,
      replace: true,
    });
    expect(r.replaced).toBe(true);
    expect(existsSync(join(folder(), "original.mp3"))).toBe(false);
    expect(
      readdirSync(folder()).filter((n) => n.startsWith("original")),
    ).toEqual(["original.flac"]);
  });

  it("leaves nothing half-written", () => {
    addSong({ filename: "x.mp3", bytes: Buffer.from("ID3"), tags });
    expect(readdirSync(folder()).some((n) => n.endsWith(".part"))).toBe(false);
  });
});

describe("adding a variant to a song", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mediatek-var-"));
    process.env.STUDIO_MEDIATEK = root;
    ensureLayout();
  });
  afterEach(() => {
    delete process.env.STUDIO_MEDIATEK;
    rmSync(root, { recursive: true, force: true });
  });

  const tags = {
    artist: "Miles Davis",
    album: "Kind of Blue",
    title: "So What",
  };
  const rel = "songs/Miles Davis/Kind of Blue/So What";
  const folder = () => join(root, rel);
  const sidecar = () => readFileSync(join(folder(), SONG_FILE), "utf8");
  const song = () =>
    addSong({ filename: "x.mp3", bytes: Buffer.from("ID3"), tags });
  const add = (filename: string, body = "RIFF") =>
    addSongVariant({ folder: rel, filename, bytes: Buffer.from(body) });

  it("writes the file beside the master and names it in the sidecar", () => {
    song();
    const r = add("instrumental.wav");
    expect(r).toMatchObject({
      path: `${rel}/instrumental.wav`,
      ref: "instrumental.wav",
      name: "instrumental",
      declared: true,
    });
    expect(readFileSync(join(folder(), "instrumental.wav"), "utf8")).toBe(
      "RIFF",
    );
    // …and the scan reads it back as a FILE variant, which is the whole point: it decides
    // that by looking for `ref` among the folder's files, so the two must agree exactly.
    expect(scanFamily("songs")[0].variants).toEqual([
      { name: "instrumental", ref: "instrumental.wav", kind: "file" },
    ]);
  });

  it("keeps the comments the sidecar was written with", () => {
    // The reason this edits text instead of round-tripping the parser: those two lines say
    // how the tree is derived, and a serialiser would drop them.
    song();
    add("instrumental.wav");
    expect(sidecar()).toContain("# Voir packages/mediatek/docs/songs.md.");
    expect(sidecar()).toContain('title: "So What"');
  });

  it("puts a second one under the same block", () => {
    song();
    add("instrumental.wav");
    add("a cappella.flac");
    expect(scanFamily("songs")[0].variants).toEqual([
      { name: "instrumental", ref: "instrumental.wav", kind: "file" },
      { name: "a cappella", ref: "a cappella.flac", kind: "file" },
    ]);
    // One block, not two: a second `variants:` key would shadow the first.
    expect(sidecar().match(/^variants:/gm)).toHaveLength(1);
  });

  it("re-sending the same file replaces its bytes and declares nothing twice", () => {
    song();
    add("instrumental.wav", "first");
    const again = add("instrumental.wav", "second");
    expect(again.declared).toBe(false);
    expect(readFileSync(join(folder(), "instrumental.wav"), "utf8")).toBe(
      "second",
    );
    expect(scanFamily("songs")[0].variants).toHaveLength(1);
  });

  it("finds a free name rather than shadowing one", () => {
    // Two files with the same stem in different formats: the refs differ, so both are real
    // variants, but the sidecar is a MAPPING and the second key would replace the first.
    song();
    add("instrumental.wav");
    expect(add("instrumental.mp3").name).toBe("instrumental 2");
    expect(scanFamily("songs")[0].variants).toHaveLength(2);
  });

  it("files one into a folder nobody catalogued, sidecar and all", () => {
    // A song dropped on the volume by hand: audio, no sidecar. Adding a version is the
    // moment it gets one — there is nowhere else a variant can be declared.
    putFile("songs/loose/whatever/original.mp3", "ID3");
    const r = addSongVariant({
      folder: "songs/loose/whatever",
      filename: "instrumental.wav",
      bytes: Buffer.from("RIFF"),
    });
    expect(r.declared).toBe(true);
    expect(scanFamily("songs")[0].variants).toEqual([
      { name: "instrumental", ref: "instrumental.wav", kind: "file" },
    ]);
  });

  it("refuses a folder that is not a song", () => {
    // Nobody invents a place in `songs/`: the shape is derived from tags, and a drop that
    // created one would be the hand-made folder at the wrong level docs/songs.md refuses.
    expect(() =>
      addSongVariant({
        folder: "songs/Miles Davis",
        filename: "x.wav",
        bytes: Buffer.from("RIFF"),
      }),
    ).toThrow(VariantRefusedError);
    expect(() =>
      addSongVariant({
        folder: "samples/kicks",
        filename: "x.wav",
        bytes: Buffer.from("RIFF"),
      }),
    ).toThrow(VariantRefusedError);
  });

  it("refuses a sidecar whose variants: is not a mapping, rather than breaking it", () => {
    // Inserting a `  "a": "b"` line under a LIST makes the whole file unparseable — and an
    // unparseable sidecar costs the song its title everywhere.
    song();
    putFile(`${rel}/${SONG_FILE}`, "title: So What\nvariants:\n  - a\n  - b\n");
    expect(() => add("instrumental.wav")).toThrow(VariantRefusedError);
    expect(existsSync(join(folder(), "instrumental.wav"))).toBe(false);
  });

  it("refuses a block written inline, which only the text can tell", () => {
    // `variants: {instru: a.wav}` parses as a perfectly good mapping, so the check above
    // passes it — and a line pushed under it would break the file just the same.
    song();
    putFile(
      `${rel}/${SONG_FILE}`,
      "title: So What\nvariants: {instru: a.wav}\n",
    );
    expect(() => add("instrumental.wav")).toThrow(VariantRefusedError);
    expect(existsSync(join(folder(), "instrumental.wav"))).toBe(false);
  });

  it("refuses what the scan would not see as audio", () => {
    song();
    expect(() => add("notes.txt")).toThrow(NotAudioError);
  });
});
