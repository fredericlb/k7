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
import { familyRevision } from "./revision.ts";
import { scanFamily, scanUnlisted } from "./scan.ts";

// The root is env-driven ($STUDIO_MEDIATEK), which is what makes it testable at all: each
// test gets its own library rather than a shared one under the real ~/.studio.
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
        modules: 0,
        chains: 0,
        playlists: 0,
        recordings: 0,
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

  it("tells a sibling FILE from a chain by looking in the folder", () => {
    // The only half the scan can settle on its own, and the direction matters: a name that is
    // not a file there is read as a CHAIN, never as a missing file. Backwards, a typo'd chain
    // name would send you hunting through the song's folder.
    write("songs/2026/song/instrumental.wav", "RIFF");
    const e = withVariants(
      "variants:\n  instru: instrumental.wav\n  sans-voix: vocal-strip\n",
    );
    expect(e.variants).toEqual([
      { name: "instru", ref: "instrumental.wav", kind: "file" },
      { name: "sans-voix", ref: "vocal-strip", kind: "chain" },
    ]);
  });

  it("is absent, not empty, when the sidecar declares none", () => {
    expect(withVariants("").variants).toBeUndefined();
  });

  it("drops a value that is not a name, rather than inventing one", () => {
    // `[object Object]` on screen is a row you cannot follow anywhere.
    const e = withVariants("variants:\n  bad: [a, b]\n  ok: other\n");
    expect(e.variants).toEqual([{ name: "ok", ref: "other", kind: "chain" }]);
  });

  it("survives `variants:` written as a list instead of a mapping", () => {
    expect(withVariants("variants:\n  - a\n  - b\n").variants).toBeUndefined();
  });
});

describe("scanning samples and modules", () => {
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

  it("lists a module folder and counts its instances", () => {
    write(
      "modules/instruments/synth/module.yaml",
      "plugin: {type: internal}\n",
    );
    write("modules/instruments/synth/lead.yaml", "params: {}\n");
    write("modules/instruments/synth/pad.yaml", "params: {}\n");
    write("modules/audio/halfbaked/readme.md"); // files, but no module.yaml — a folder
    const byName = Object.fromEntries(
      scanFamily("modules").map((e) => [e.name, e]),
    );
    expect(byName.synth.kind).toBe("instruments");
    expect(byName.synth.meta?.instances).toBe(2);
    // A folder holding anything BUT a module file is still a folder, not a half-made module.
    expect(byName.halfbaked).toBeUndefined();
  });

  it("reports what a module carries in its own assets folder", () => {
    // What the module LOADS, as opposed to what it IS: a tree draws these as its children and
    // drops new ones in. Its own field, because `files` is the definition and these are material.
    write("modules/audio/amp/module.yaml", "plugin: {}\n");
    write("modules/audio/amp/assets/jcm800.nam", "profile");
    write("modules/audio/amp/assets/room.wav", "ir");
    const amp = scanFamily("modules").find((e) => e.name === "amp");
    expect(amp?.assets).toEqual(["jcm800.nam", "room.wav"]);
    expect(amp?.files).toEqual(["module.yaml"]); // the folder itself, not what is under it
  });

  it("keeps an asset from becoming an entry, or a folder to browse", () => {
    // The descent stops at a module; `assets/` is inside one, so it must reach neither the
    // catalogue (a sample is not a module) nor `scanUnlisted` (it is already drawn, on its
    // module) — a row in both places is a file that looks like two different things.
    write("modules/audio/amp/module.yaml", "plugin: {}\n");
    write("modules/audio/amp/assets/room.wav", "ir");
    const entries = scanFamily("modules");
    expect(entries.map((e) => e.path)).toEqual(["modules/audio/amp"]);
    expect(
      scanUnlisted("modules", entries).filter((p) => p.includes("assets")),
    ).toEqual([]);
  });

  it("says nothing at all about assets when there are none", () => {
    write("modules/audio/fuzz/module.yaml", "plugin: {}\n");
    expect(scanFamily("modules")[0]?.assets).toBeUndefined();
  });

  it("finds a module at ANY depth — the file is the rule, not the shape", () => {
    // It used to read exactly two levels, mirroring the one-category shape the compiler accepts.
    // That made the folders in between a fixed grammar: a third level was invisible, and dragging
    // a module into one dropped it out of the catalogue. A module is a folder with a module file.
    write("modules/audio/fuzz/module.yaml", "plugin: {}\n"); //           one deep
    write("modules/audio/filter/auto-wah/module.yaml", "plugin: {}\n"); // two
    write("modules/audio/dyn/comp/vintage/module.yaml", "plugin: {}\n"); // three
    const paths = scanFamily("modules").map((e) => e.path);
    expect(paths).toContain("modules/audio/fuzz");
    expect(paths).toContain("modules/audio/filter/auto-wah");
    expect(paths).toContain("modules/audio/dyn/comp/vintage");
  });

  it("catalogues MODULES only — a folder is not one, wherever it sits", () => {
    // Both used to be listed: the folder on the way, and the folder somebody just made. That put
    // a row in the middle pane for something nobody authored, and counted it in the Modules tab.
    write("modules/audio/filter/auto-wah/module.yaml", "plugin: {}\n");
    write("modules/audio/modulation/.keep"); // a folder, made by hand
    const paths = scanFamily("modules").map((e) => e.path);
    expect(paths).toEqual(["modules/audio/filter/auto-wah"]);
  });

  it("still reports those folders, so a tree can draw one", () => {
    // The route made for it: what no entry accounts for. Without this an empty folder is a
    // folder you cannot see, and one you cannot see is one you cannot drop into.
    write("modules/audio/filter/auto-wah/module.yaml", "plugin: {}\n");
    write("modules/audio/modulation/.keep");
    const unlisted = scanUnlisted("modules", scanFamily("modules"));
    expect(unlisted).toContain("audio/modulation");
    // …but not the folders on the way to a module: the entry's own path already draws them.
    expect(unlisted).not.toContain("audio/filter");
  });

  it("stops AT a module — what is inside one is its files, never more modules", () => {
    write("modules/audio/fuzz/module.yaml", "plugin: {}\n");
    write("modules/audio/fuzz/nested/module.yaml", "plugin: {}\n");
    const paths = scanFamily("modules").map((e) => e.path);
    expect(paths).toContain("modules/audio/fuzz");
    expect(paths).not.toContain("modules/audio/fuzz/nested");
  });

  // A chain is a TEMPLATE: segments wiring named instances to each other, with `@in` and `@out`
  // standing where a project would have a track and a sink. Same rule as a module — the file is
  // what makes the folder — so the two scans read alike on purpose.
  it("catalogues a chain by its chains.yaml, at any depth", () => {
    write(
      "chains/gtr/chains.yaml",
      'tracks:\n  "@in": [ eq ]\nmodules:\n  eq: [ "@out" ]\n',
    );
    write("chains/live/vocals/chains.yaml", 'tracks:\n  "@in": [ "@out" ]\n');
    const paths = scanFamily("chains").map((e) => e.path);
    expect(paths).toEqual(["chains/gtr", "chains/live/vocals"]);
  });

  it("counts the instances beside the file, not the files in the folder", () => {
    // How big a template is, without opening it. The instances live in their own folder, so
    // counting the chain's own files would report the chains.yaml and any notes beside it.
    write("chains/gtr/chains.yaml", 'tracks:\n  "@in": [ "@out" ]\n');
    write("chains/gtr/README.md", "notes");
    write("chains/gtr/instances/eq.yaml", 'extends: "@mediatek/audio/eq"\n');
    write(
      "chains/gtr/instances/comp.yaml",
      'extends: "@mediatek/audio/comp"\n',
    );
    const [chain] = scanFamily("chains");
    expect(chain.meta?.instances).toBe(2);
    expect(chain.files).toContain("chains.yaml");
  });

  it("stops AT a chain — instances/ is inside one, not a chain of its own", () => {
    write("chains/gtr/chains.yaml", 'tracks:\n  "@in": [ "@out" ]\n');
    write("chains/gtr/instances/chains.yaml", "modules: {}\n"); // pathological, but decisive
    expect(scanFamily("chains").map((e) => e.path)).toEqual(["chains/gtr"]);
  });

  it("ignores a folder outside the known module types", () => {
    // The mediatek is a workspace's `_modules` promoted: a type folder it doesn't know
    // resolves nowhere, so listing it would promise something that cannot be loaded.
    write("modules/not_a_type/thing/module.yaml", "plugin: {}\n");
    expect(scanFamily("modules")).toHaveLength(0);
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
    // The reason the token is per family: importing a song must not invalidate modules.
    // Each token is only ever compared with its OWN previous value — two families holding
    // one file each produce the same string, and that means nothing.
    write("modules/instruments/synth/module.yaml", "plugin: {}\n");
    const modulesBefore = familyRevision("modules");
    const songsBefore = familyRevision("songs");
    write("songs/song/song.yaml", "title: T\n");
    expect(familyRevision("modules")).toBe(modulesBefore);
    expect(familyRevision("songs")).not.toBe(songsBefore);
  });

  it("ignores the derived cache, which would otherwise invalidate itself", () => {
    const before = familyRevision("samples");
    mkdirSync(join(root, "samples", ".cache"), { recursive: true });
    writeFileSync(join(root, "samples", ".cache", "x.json"), "{}");
    expect(familyRevision("samples")).toBe(before);
  });
});

describe("listing and search", () => {
  beforeEach(() => {
    ensureLayout();
    write("samples/audio/kicks/bd01.wav");
    write("samples/audio/kicks/sn01.wav");
    write("modules/instruments/synth/module.yaml", "plugin: {}\n");
  });

  it("serves the cached listing while the family is unchanged", () => {
    const first = listFamily("samples");
    expect(listFamily("samples")).toBe(first); // same object — no rescan
  });

  it("rescans once the family moves", () => {
    const first = listFamily("samples");
    const f = write("samples/audio/kicks/hh01.wav");
    // mtime granularity is coarse enough that a fresh file can land in the same tick as
    // the last one; the file COUNT is what carries this case, and it changed.
    utimesSync(f, new Date(), new Date());
    const second = listFamily("samples");
    expect(second).not.toBe(first);
    expect(second.entries).toHaveLength(3);
  });

  it("filters by family, kind and substring", () => {
    expect(search({ family: "samples" })).toHaveLength(2);
    expect(search({ q: "bd" }).map((e) => e.name)).toEqual(["bd01.wav"]);
    expect(search({ family: "modules", kind: "instruments" })).toHaveLength(1);
    expect(search({ q: "nothing-matches" })).toEqual([]);
  });

  it("lists a playlist as the FILE, not as a folder around one", () => {
    ensureLayout();
    write(
      "playlists/live/ete.yaml",
      "title: Été 2026\nitems:\n  - AC-DC/Back in Black/Hells Bells\n",
    );
    const [p] = scanFamily("playlists");
    // The entry's path is the file itself — the one family besides samples where that is so,
    // because there is nothing beside a playlist to keep. See scanPlaylists.
    expect(p.path).toBe("playlists/live/ete.yaml");
    expect(p.name).toBe("Été 2026"); // the title, not the file name
    expect(p.meta).toMatchObject({ catalogued: true, items: 1 });
  });

  it("still lists a playlist whose YAML is broken, so you can click it and fix it", () => {
    ensureLayout();
    write("playlists/cassee.yaml", "items: [\n");
    const [p] = scanFamily("playlists");
    // `catalogued: false` is the same word an unfiled song folder gets: it is on the disk.
    expect(p.name).toBe("cassee");
    expect(p.meta).toMatchObject({ catalogued: false, items: 0 });
  });

  it("counts every family for the summary screen", () => {
    // Plus the capture zone, which is no family but is a tab — see docs/recordings.md.
    expect(summary()).toEqual({
      present: true,
      counts: {
        songs: 0,
        samples: 2,
        modules: 1,
        chains: 0,
        playlists: 0,
        recordings: 0,
      },
    });
  });
});

// A tree draws itself from the entry paths. That works until the thing on disk is not an
// entry: the folder `POST /folder` just made, or a file dropped where no catalogue reaches.
// Both answered 200 and appeared nowhere, which reads as the call having done nothing.
describe("what the entries cannot stand for", () => {
  it("reports an empty folder, which no entry can stand for", () => {
    mkdirSync(join(root, "modules", "audio"), { recursive: true });
    expect(listFamily("modules").unlisted).toEqual(["audio"]);
  });

  it("stops reporting it once it holds something", () => {
    write("modules/audio/reverb/module.yaml", "plugin: {}\n");
    const l = listFamily("modules");
    expect(l.entries.map((e) => e.path)).toEqual(["modules/audio/reverb"]);
    // `audio` is on the way to an entry, so the tree already draws it; saying so twice
    // would be one more thing to keep in step.
    expect(l.unlisted).toEqual([]);
  });

  it("does not descend into an ENTRY's own folder", () => {
    // A module IS a folder, and its insides are its own — they travel on the entry itself.
    write("modules/audio/reverb/module.yaml", "plugin: {}\n");
    mkdirSync(join(root, "modules", "audio", "reverb", "scratch"), {
      recursive: true,
    });
    expect(listFamily("modules").unlisted).toEqual([]);
  });

  it("reports a loose FILE too, not just a folder", () => {
    // Dropped where no catalogue reaches: `modules/<type>` lists DIRECTORIES, so a file
    // sitting beside them was on disk and nowhere on screen.
    write("modules/audio/stray.yaml", "x\n");
    expect(listFamily("modules").unlisted).toEqual([
      "audio",
      "audio/stray.yaml",
    ]);
  });

  it("files a CATEGORY's modules, not the category", () => {
    // `audio/filter/auto-wah` is the shape the shared library ships (see @studio/song's
    // docs/uiLibrary.md). Listing only one level filed `filter` itself as a module, so
    // opening it looked for a module.yaml that was never going to be there — "not found" —
    // and auto-wah was absent from the catalogue altogether.
    write("modules/audio/filter/auto-wah/module.yaml", "plugin: {}\n");
    const l = listFamily("modules");
    expect(l.entries.map((e) => e.path)).toEqual([
      "modules/audio/filter/auto-wah",
    ]);
    expect(l.entries[0].name).toBe("auto-wah");
    // …and the category is not reported as a stray either: it is on the way to an entry.
    expect(l.unlisted).toEqual([]);
  });

  it("reports a folder that is neither as UNLISTED, not as an entry", () => {
    // It used to arrive as an entry flagged `catalogued: false`, which drew it in the catalogue
    // pane and counted it in the Modules tab — a row for something nobody authored. It is still
    // reported, by the route meant for it, so a tree draws it and you can drop into it.
    mkdirSync(join(root, "modules", "audio", "mine"), { recursive: true });
    const l = listFamily("modules");
    expect(l.entries).toEqual([]);
    expect(l.unlisted).toContain("audio/mine");
  });

  it("carries a module's OWN files on the entry", () => {
    // THE bug this pins: the tree drew three fixed rows (module/ui/presets), so a folder
    // dropped with two files of its own showed neither of them and both canonical names
    // read "(nouveau)" — which looks exactly like the drop having been flattened.
    write("modules/audio/reverb/module.yaml", "plugin: {}\n");
    write("modules/audio/reverb/lead.yaml", "params: {}\n");
    const m = listFamily("modules").entries[0];
    expect(m.files).toEqual(["lead.yaml", "module.yaml"]);
    expect(m.meta?.instances).toBe(1); // the panel and the shelf are not uses of it
  });

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

// The index is a warm start, never a source of truth — but it survived a code change, and
// the revision token cannot notice one: it tracks the FILES. So a listing written by an
// older build matched a token computed by a newer one, and the cache answered yesterday's
// question. That is how a category kept coming back as a module after the scan was fixed.
describe("the persisted index", () => {
  beforeEach(() => ensureLayout());

  it("is dropped when it was written by another build", () => {
    write("modules/audio/filter/auto-wah/module.yaml", "plugin: {}\n");
    const fresh = listFamily("modules");
    // What the old build left: the right token, the wrong answer.
    writeFileSync(
      join(root, ".cache", "index.json"),
      JSON.stringify({
        families: {
          modules: {
            family: "modules",
            rev: fresh.rev,
            entries: [
              {
                family: "modules",
                id: "x",
                name: "filter",
                path: "modules/audio/filter",
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
    // Unversioned, so it is not trusted at all — the walk answers instead.
    expect(listFamily("modules").entries.map((e) => e.name)).toEqual([
      "auto-wah",
    ]);
  });

  it("still warm-starts from one this build wrote", () => {
    // The gate must not cost the feature. Persist, then make the DISK disagree without
    // moving the token: the cached answer coming back is what proves no walk happened.
    write("modules/audio/reverb/module.yaml", "plugin: {}\n");
    listFamily("modules"); // persists
    reset();
    const raw = JSON.parse(
      readFileSync(join(root, ".cache", "index.json"), "utf8"),
    ) as { families: Record<string, { entries: { name: string }[] }> };
    raw.families.modules.entries[0].name = "from-the-index";
    writeFileSync(join(root, ".cache", "index.json"), JSON.stringify(raw));
    expect(listFamily("modules").entries.map((e) => e.name)).toEqual([
      "from-the-index",
    ]);
  });
});

// parseQuery — the two HTTP shells' shared reading of an untrusted query string. It had no test at
// all while it was duplicated in both of them, clamp included.
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
