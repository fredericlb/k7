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
import {
  MorceauExistsError,
  masterName,
  morceauFolder,
  NotAudioError,
  segment,
  tagsFromFilename,
} from "./morceau.ts";
import { scanFamily } from "./scan.ts";
import { addMorceau } from "./write.ts";

describe("the deduced tree", () => {
  it("is artiste/album/titre under imported", () => {
    expect(
      morceauFolder({
        artist: "Miles Davis",
        album: "Kind of Blue",
        title: "So What",
      }),
    ).toBe("morceaux/imported/Miles Davis/Kind of Blue/So What");
  });

  it("names the hole rather than refusing a file with no album", () => {
    expect(morceauFolder({ artist: "Miles Davis", title: "So What" })).toBe(
      "morceaux/imported/Miles Davis/Album inconnu/So What",
    );
    expect(morceauFolder({})).toBe(
      "morceaux/imported/Artiste inconnu/Album inconnu/Sans titre",
    );
  });

  it("keeps a tag from becoming a path", () => {
    // The whole point: a client sends tags, never a path. A slash in a title must not open
    // a folder, and `..` must not climb one.
    expect(segment("AC/DC", "x")).toBe("AC DC");
    expect(morceauFolder({ artist: "../../etc", title: "x" })).toBe(
      "morceaux/imported/.. .. etc/Album inconnu/x",
    );
  });

  it("takes the provenance folder from the caller", () => {
    // k7 publishes a version here: the studio produced it, so `recorded` — not
    // `imported`, which means somebody else's master.
    expect(
      morceauFolder(
        { artist: "K7", album: "Sous la pluie", title: "Mix final" },
        "recorded",
      ),
    ).toBe("morceaux/recorded/K7/Sous la pluie/Mix final");
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
    root = mkdtempSync(join(tmpdir(), "mediatek-m-"));
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
  const folder = () =>
    join(root, "morceaux/imported/Miles Davis/Kind of Blue/So What");

  it("creates the tree and the sidecar", () => {
    const r = addMorceau({
      filename: "whatever.mp3",
      bytes: Buffer.from("ID3"),
      tags,
    });
    expect(r.path).toBe("morceaux/imported/Miles Davis/Kind of Blue/So What");
    expect(readFileSync(join(folder(), "original.mp3"), "utf8")).toBe("ID3");
    expect(readFileSync(join(folder(), "morceau.yaml"), "utf8")).toContain(
      'title: "So What"',
    );
  });

  it("files a published version under its own kind, saying who filed it", () => {
    const r = addMorceau({
      filename: "mixdown.mp3",
      bytes: Buffer.from("MIX"),
      kind: "recorded",
      tags: {
        artist: "K7",
        album: "Sous la pluie",
        title: "Mix final",
        source: "k7",
      },
    });
    expect(r.master).toBe(
      "morceaux/recorded/K7/Sous la pluie/Mix final/original.mp3",
    );
    const sidecar = readFileSync(join(root, r.path, "morceau.yaml"), "utf8");
    expect(sidecar).toContain('artist: "K7"');
    expect(sidecar).toContain("source: k7");
    // …and it is a morceau like any other: the scan lists it, with its own provenance.
    const [e] = scanFamily("morceaux");
    expect(e.kind).toBe("recorded");
    expect(e.meta?.artist).toBe("K7");
  });

  it("lands as one catalogued entry the scan can play", () => {
    addMorceau({ filename: "x.mp3", bytes: Buffer.from("ID3"), tags });
    const entries = scanFamily("morceaux");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("So What");
    expect(entries[0].kind).toBe("imported");
    expect(entries[0].meta?.catalogued).toBe(true);
    // Without this the moteur, which opens paths, has nothing to open.
    expect(entries[0].meta?.master).toBe("original.mp3");
  });

  it("refuses to clobber a morceau already there", () => {
    addMorceau({ filename: "x.mp3", bytes: Buffer.from("first"), tags });
    expect(() =>
      addMorceau({ filename: "x.mp3", bytes: Buffer.from("second"), tags }),
    ).toThrow(MorceauExistsError);
    expect(readFileSync(join(folder(), "original.mp3"), "utf8")).toBe("first");
  });

  it("replaces when told to, leaving ONE master behind", () => {
    addMorceau({ filename: "x.mp3", bytes: Buffer.from("first"), tags });
    const r = addMorceau({
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
    addMorceau({ filename: "x.mp3", bytes: Buffer.from("ID3"), tags });
    expect(readdirSync(folder()).some((n) => n.endsWith(".part"))).toBe(false);
  });
});
