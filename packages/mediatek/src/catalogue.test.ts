import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listFamily,
  parseQuery,
  reset,
  SEARCH_LIMIT_MAX,
  search,
  summary,
} from "./catalogue.ts";
import { ensureLayout, exists, mediatekDir, schemaVersion } from "./layout.ts";
import {
  bumped,
  familyRevision,
  refreshRevisions,
  stopRevisionRefresh,
} from "./revision.ts";
import { scanFamily, scanUnlisted } from "./scan.ts";

// The root is env-driven ($STUDIO_MEDIATEK), so each test gets its own library, not ~/.st0.
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-"));
  process.env.STUDIO_MEDIATEK = root;
  reset();
});

afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
  reset();
});

const write = (rel: string, body = "x"): string => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
  return abs;
};

describe("the layout", () => {
  it("reports no library until one is created", () => {
    expect(exists()).toBe(false);
    // `present: false` is an answer, not an error — a surface shows "nothing here yet".
    expect(summary()).toEqual({
      present: false,
      counts: {
        songs: 0,
        samples: 0,
        recordings: 0,
        playlists: 0,
      },
    });
  });

  it("creates the layout idempotently and never rewrites a hand-edited marker", () => {
    expect(ensureLayout()).toBe(mediatekDir());
    expect(exists()).toBe(true);
    expect(schemaVersion()).toBe(1);
    writeFileSync(join(root, "mediatek.yaml"), "version: 1\nnamespace: mine\n");
    ensureLayout();
    expect(schemaVersion()).toBe(1);
    expect(readFileSync(join(root, "mediatek.yaml"), "utf8")).toContain(
      "namespace: mine",
    );
  });
});

describe("scanning songs", () => {
  beforeEach(() => ensureLayout());

  it("reads title and artist from the sidecar", () => {
    write(
      "songs/2026/take-one/song.yaml",
      "title: Sous la pluie\nartist: K7\n",
    );
    write("songs/2026/take-one/master.wav", "RIFF");
    const [e] = scanFamily("songs");
    expect(e.name).toBe("Sous la pluie");
    // No subdivision in this family, so no word to put here — see MediatekEntry.kind.
    expect(e.kind).toBe("");
    expect(e.meta?.artist).toBe("K7");
    expect(e.meta?.catalogued).toBe(true);
    expect(e.bytes).toBe(4);
  });

  it("still lists a folder dropped in by hand, flagged as not filed", () => {
    // The whole point is seeing what you own — an uncatalogued file must not be invisible.
    write("songs/loose/whatever.mp3", "ID3");
    const [e] = scanFamily("songs");
    expect(e.name).toBe("loose");
    expect(e.meta?.catalogued).toBe(false);
  });

  it("survives an unparseable sidecar rather than losing the entry", () => {
    write("songs/broken/song.yaml", "title: [unclosed\n");
    const [e] = scanFamily("songs");
    expect(e.name).toBe("broken"); // falls back to the folder name
  });

  it("treats an entry as a leaf and does not descend into it", () => {
    write("songs/album/song.yaml", "title: Album\n");
    write("songs/album/stems/gtr.wav", "RIFF");
    expect(scanFamily("songs")).toHaveLength(1);
  });
});

describe("a song's variants", () => {
  beforeEach(() => ensureLayout());

  const withVariants = (yaml: string) => {
    write(`songs/2026/song/song.yaml`, `title: T\n${yaml}`);
    write("songs/2026/song/original.wav", "RIFF");
    return scanFamily("songs")[0];
  };

  it("tells a sibling file from one that is not there, by looking in the folder", () => {
    // A name that is not a file in the song's folder reads as MISSING — see docs/variants.md.
    write("songs/2026/song/instrumental.wav", "RIFF");
    const e = withVariants(
      "variants:\n  instru: instrumental.wav\n  sans-voix: vocal-strip\n",
    );
    expect(e.variants).toEqual([
      { name: "instru", ref: "instrumental.wav", kind: "file" },
      { name: "sans-voix", ref: "vocal-strip", kind: "missing" },
    ]);
  });

  it("is absent, not empty, when the sidecar declares none", () => {
    expect(withVariants("").variants).toBeUndefined();
  });

  it("drops a value that is not a name, rather than inventing one", () => {
    // `[object Object]` on screen is a row you cannot follow anywhere.
    const e = withVariants("variants:\n  bad: [a, b]\n  ok: other\n");
    expect(e.variants).toEqual([{ name: "ok", ref: "other", kind: "missing" }]);
  });

  it("survives `variants:` written as a list instead of a mapping", () => {
    expect(withVariants("variants:\n  - a\n  - b\n").variants).toBeUndefined();
  });
});

describe("scanning samples", () => {
  beforeEach(() => ensureLayout());

  it("groups samples by pack and filters by media kind", () => {
    write("samples/audio/kicks/bd01.wav");
    write("samples/audio/kicks/notes.txt"); // not media — must not be listed
    write("samples/video/bumpers/intro.mp4");
    const audio = scanFamily("samples").filter((e) => e.kind === "audio");
    expect(audio.map((e) => e.name)).toEqual(["bd01.wav"]);
    expect(audio[0].meta?.pack).toBe("kicks");
    expect(
      scanFamily("samples").filter((e) => e.kind === "video"),
    ).toHaveLength(1);
  });
});

describe("the revision token", () => {
  beforeEach(() => ensureLayout());

  it("moves when its own family changes", () => {
    const before = familyRevision("samples");
    write("samples/audio/kicks/bd01.wav");
    expect(familyRevision("samples")).not.toBe(before);
  });

  it("does NOT move when another family changes", () => {
    // Why the token is per family: importing a song must not invalidate the samples.
    write("samples/audio/kicks/bd01.wav");
    const samplesBefore = familyRevision("samples");
    const songsBefore = familyRevision("songs");
    write("songs/song/song.yaml", "title: T\n");
    expect(familyRevision("samples")).toBe(samplesBefore);
    expect(familyRevision("songs")).not.toBe(songsBefore);
  });

  it("ignores the derived cache, which would otherwise invalidate itself", () => {
    const before = familyRevision("samples");
    mkdirSync(join(root, "samples", ".cache"), { recursive: true });
    writeFileSync(join(root, "samples", ".cache", "x.json"), "{}");
    expect(familyRevision("samples")).toBe(before);
  });

  it("ignores a waveform sidecar, for the same reason", () => {
    // The sweep that fills them would otherwise invalidate the listing it is walking.
    write("samples/audio/kicks/bd01.wav");
    const before = familyRevision("samples");
    write("samples/audio/kicks/bd01.wav.cache", "{}");
    expect(familyRevision("samples")).toBe(before);
  });
});

describe("the refreshed token", () => {
  beforeEach(() => ensureLayout());
  afterEach(() => stopRevisionRefresh());

  it("answers from the last walk, and walks again when told", async () => {
    write("samples/audio/kicks/bd01.wav");
    await refreshRevisions();
    const before = familyRevision("samples");
    const f = write("samples/audio/kicks/sn01.wav");
    utimesSync(f, new Date(), new Date());
    // The point of the whole thing: a poll costs a map lookup, not a walk of the library.
    expect(familyRevision("samples")).toBe(before);
    await refreshRevisions();
    expect(familyRevision("samples")).not.toBe(before);
  });

  it("still moves on our OWN write, before any walk confirms it", async () => {
    await refreshRevisions();
    const before = familyRevision("songs");
    bumped("songs");
    expect(familyRevision("songs")).not.toBe(before);
  });
});

describe("listing and search", () => {
  beforeEach(() => {
    ensureLayout();
    write("samples/audio/kicks/bd01.wav");
    write("samples/audio/kicks/sn01.wav");
    write("songs/AC-DC/Back in Black/Hells Bells/original.wav");
  });

  it("serves the cached listing while the family is unchanged", () => {
    const first = listFamily("samples");
    expect(listFamily("samples")).toBe(first); // same object — no rescan
  });

  it("rescans once the family moves", () => {
    const first = listFamily("samples");
    const f = write("samples/audio/kicks/hh01.wav");
    // A fresh file can land in the same mtime tick, so the file COUNT is what carries this case.
    utimesSync(f, new Date(), new Date());
    const second = listFamily("samples");
    expect(second).not.toBe(first);
    expect(second.entries).toHaveLength(3);
  });

  it("filters by family, kind and substring", () => {
    expect(search({ family: "samples" })).toHaveLength(2);
    expect(search({ q: "bd" }).map((e) => e.name)).toEqual(["bd01.wav"]);
    expect(search({ family: "songs" })).toHaveLength(1);
    expect(search({ q: "nothing-matches" })).toEqual([]);
  });

  it("counts every family for the summary screen", () => {
    // Plus the two root zones, neither a family and both a tab — see docs/recordings.md.
    expect(summary()).toEqual({
      present: true,
      counts: {
        songs: 1,
        samples: 2,
        recordings: 0,
        playlists: 0,
      },
    });
  });
});

// A tree draws itself from the entry paths, so what is not an entry appears nowhere — docs/index.md.
describe("what the entries cannot stand for", () => {
  it("reports a nested empty folder and the one above it", () => {
    mkdirSync(join(root, "samples", "audio", "packs", "kicks"), {
      recursive: true,
    });
    expect(listFamily("samples").unlisted).toEqual([
      "audio",
      "audio/packs",
      "audio/packs/kicks",
    ]);
  });
});

// An index can survive a code change the revision token cannot notice — docs/index.md.
describe("the persisted index", () => {
  beforeEach(() => ensureLayout());

  it("is dropped when it was written by another build", () => {
    write("samples/audio/kicks/bd01.wav");
    const fresh = listFamily("samples");
    // What an older build leaves behind: the right token, the wrong answer.
    writeFileSync(
      join(root, ".cache", "index.json"),
      JSON.stringify({
        families: {
          samples: {
            family: "samples",
            rev: fresh.rev,
            entries: [
              {
                family: "samples",
                id: "x",
                name: "stale",
                path: "samples/audio/kicks",
                kind: "audio",
                mtime: 0,
              },
            ],
            unlisted: [],
          },
        },
      }),
      "utf8",
    );
    reset();
    // Unversioned, so it is not trusted at all -- the walk answers instead.
    expect(listFamily("samples").entries.map((e) => e.name)).toEqual([
      "bd01.wav",
    ]);
  });

  it("still warm-starts from one this build wrote", () => {
    // Make the DISK disagree without moving the token: the cached answer proves no walk happened.
    write("samples/audio/kicks/bd01.wav");
    listFamily("samples"); // persists
    reset();
    const raw = JSON.parse(
      readFileSync(join(root, ".cache", "index.json"), "utf8"),
    ) as { families: Record<string, { entries: { name: string }[] }> };
    raw.families.samples.entries[0].name = "from-the-index";
    writeFileSync(join(root, ".cache", "index.json"), JSON.stringify(raw));
    expect(listFamily("samples").entries.map((e) => e.name)).toEqual([
      "from-the-index",
    ]);
  });
});

// parseQuery — the two HTTP shells' shared reading of an untrusted query string, untested while duplicated.
describe("parseQuery", () => {
  it("keeps a sane limit", () => {
    expect(parseQuery({ limit: "5" }).limit).toBe(5);
  });

  it("clamps a greedy one rather than trusting it", () => {
    expect(parseQuery({ limit: "99999" }).limit).toBe(SEARCH_LIMIT_MAX);
  });

  it("floors a fractional one", () => {
    expect(parseQuery({ limit: "7.9" }).limit).toBe(7);
  });

  // undefined means NO limit, not "limit zero" — search({}) legitimately returns everything.
  it("gives up on anything that is not a positive number", () => {
    for (const limit of ["0", "-1", "abc", "", undefined, ["1", "2"]])
      expect(parseQuery({ limit }).limit).toBeUndefined();
  });

  it("narrows the family and drops a bogus one", () => {
    expect(parseQuery({ family: "songs" }).family).toBe("songs");
    expect(parseQuery({ family: "bogus" }).family).toBeUndefined();
  });

  // A repeated parameter arrives as an array; it must not become a filter object.
  it("takes q and kind only as strings", () => {
    expect(parseQuery({ q: "kick", kind: "recorded" })).toMatchObject({
      q: "kick",
      kind: "recorded",
    });
    const arrays = parseQuery({ q: ["a", "b"], kind: ["c"] });
    expect(arrays.q).toBeUndefined();
    expect(arrays.kind).toBeUndefined();
  });
});
