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
import { scanFamily } from "./scan.ts";

// The root is env-driven ($LANES_MEDIATEK), which is what makes it testable at all: each
// test gets its own library rather than a shared one under the real ~/.lanes.
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-"));
  process.env.LANES_MEDIATEK = root;
  reset();
});

afterEach(() => {
  delete process.env.LANES_MEDIATEK;
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
      counts: { morceaux: 0, samples: 0, modules: 0 },
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

  it("lists a module folder, counts its instances, flags one with no module.yaml", () => {
    write(
      "modules/instruments/synth/module.yaml",
      "plugin: {type: internal}\n",
    );
    write("modules/instruments/synth/lead.yaml", "params: {}\n");
    write("modules/instruments/synth/pad.yaml", "params: {}\n");
    write("modules/audio/halfbaked/readme.md");
    const byName = Object.fromEntries(
      scanFamily("modules").map((e) => [e.name, e]),
    );
    expect(byName.synth.kind).toBe("instruments");
    expect(byName.synth.meta?.instances).toBe(2);
    expect(byName.synth.meta?.catalogued).toBe(true);
    expect(byName.halfbaked.meta?.catalogued).toBe(false);
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
    expect(summary()).toEqual({
      present: true,
      counts: { morceaux: 0, samples: 2, modules: 1 },
    });
  });
});
