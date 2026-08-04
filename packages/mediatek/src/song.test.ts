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
} from "./song.ts";
import { addSong } from "./write.ts";

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
