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
import { listFamily, reset, search, summary } from "./catalogue.ts";
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
        morceaux: 0,
        samples: 0,
        modules: 0,
        chains: 0,
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

describe("scanning morceaux", () => {
  beforeEach(() => ensureLayout());

  it("reads title and artist from the sidecar", () => {
    write(
      "morceaux/recorded/2026/take-one/morceau.yaml",
      "title: Sous la pluie\nartist: K7\n",
    );
    write("morceaux/recorded/2026/take-one/master.wav", "RIFF");
    const [e] = scanFamily("morceaux");
    expect(e.name).toBe("Sous la pluie");
    expect(e.kind).toBe("recorded");
    expect(e.meta?.artist).toBe("K7");
    expect(e.meta?.catalogued).toBe(true);
    expect(e.bytes).toBe(4);
  });

  it("still lists a folder dropped in by hand, flagged as not filed", () => {
    // The whole point is seeing what you own — an uncatalogued file must not be invisible.
    write("morceaux/imported/loose/whatever.mp3", "ID3");
    const [e] = scanFamily("morceaux");
    expect(e.name).toBe("loose");
    expect(e.meta?.catalogued).toBe(false);
  });

  it("survives an unparseable sidecar rather than losing the entry", () => {
    write("morceaux/imported/broken/morceau.yaml", "title: [unclosed\n");
    const [e] = scanFamily("morceaux");
    expect(e.name).toBe("broken"); // falls back to the folder name
  });

  it("treats an entry as a leaf and does not descend into it", () => {
    write("morceaux/recorded/album/morceau.yaml", "title: Album\n");
    write("morceaux/recorded/album/stems/gtr.wav", "RIFF");
    expect(scanFamily("morceaux")).toHaveLength(1);
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
    // The reason the token is per family: importing a morceau must not invalidate modules.
    // Each token is only ever compared with its OWN previous value — two families holding
    // one file each produce the same string, and that means nothing.
    write("modules/instruments/synth/module.yaml", "plugin: {}\n");
    const modulesBefore = familyRevision("modules");
    const morceauxBefore = familyRevision("morceaux");
    write("morceaux/imported/song/morceau.yaml", "title: T\n");
    expect(familyRevision("modules")).toBe(modulesBefore);
    expect(familyRevision("morceaux")).not.toBe(morceauxBefore);
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

  it("counts every family for the summary screen", () => {
    // Plus the capture zone, which is no family but is a tab — see docs/recordings.md.
    expect(summary()).toEqual({
      present: true,
      counts: { morceaux: 0, samples: 2, modules: 1, chains: 0, recordings: 0 },
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
