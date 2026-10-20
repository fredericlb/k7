// A paired machine's library is FOLLOWED read-only: the follow undoes every file the room lacks, and keeps
// the folders and dot-files no capture sees. These tests stand in for that follow and check that the hub
// adds a seed version once, never into a followed folder, and sweeps the husks a follow left.
// See docs/fileHub.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { LibraryStore } from "./libraries.ts";

let data: string;
let seed: string;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "hub-libs-follow-"));
  data = join(tmp, "data");
  seed = join(tmp, "seed");
  mkdirSync(join(seed, "k7-core", "modules"), { recursive: true });
  mkdirSync(join(seed, "k7-core", "samples"), { recursive: true });
  writeFileSync(join(seed, "k7-core", "modules", "mix.k7x"), 'plugin("v1")\n');
  writeFileSync(join(seed, "k7-core", "samples", ".gitkeep"), "");
});

/** The repo's k7-core moves to version 2, as an app update's bundle does. */
function seedDeclares2(): void {
  writeFileSync(join(seed, "k7-core", "modules", "mix.k7x"), 'plugin("v2")\n');
  writeFileSync(
    join(seed, "k7-core", "library.k7x"),
    'name("k7-core")\nversion(2)\nrequires(1)\nnotes("fixed")\n',
  );
}

/** What a follow of an origin holding only version 1 does: every file of another version undone, its folders and dot-files left. */
function followUndoes(home: string): void {
  const at = join(home, "k7-core");
  for (const v of readdirSync(at)) if (v !== "1") undoFiles(join(at, v));
}

function undoFiles(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) undoFiles(join(dir, e.name));
    else rmSync(join(dir, e.name));
  }
}

const folders = (store: LibraryStore) =>
  readdirSync(join(store.home, "k7-core")).sort();

describe("a seed version on a followed library", () => {
  it("never loops: a follow undoing the seed's copy no longer makes the next ensure add another", async () => {
    let paired = false;
    const store = new LibraryStore(data, seed, () => paired);
    await store.ensure();
    seedDeclares2();
    paired = true;
    for (let i = 0; i < 5; i++) {
      expect(await store.ensure()).toMatchObject([
        { name: "k7-core", state: "current", note: "followed from its origin" },
      ]);
      followUndoes(store.home);
    }
    expect(folders(store)).toEqual(["1"]);
    expect(await store.publish("k7-core")).toEqual({
      error: "'k7-core' follows its origin read-only: publish it there",
    });
  });

  it("makes no draft for an admin and fetches nothing into a followed folder", async () => {
    const store = new LibraryStore(data, seed, () => true);
    mkdirSync(join(store.home, "k7-core", "1"), { recursive: true });
    writeFileSync(
      join(store.home, "k7-core", "1", "library.k7x"),
      'name("k7-core")\nversion(1)\nrequires(1)\n',
    );
    await store.ensure({ draft: true });
    expect(folders(store)).toEqual(["1"]);
    expect(await store.fetchVersion("k7-core", 1)).toMatchObject({
      state: "current",
    });
    expect(await store.fetchVersion("k7-core", 5)).toMatchObject({
      state: "failed",
      note: expect.stringContaining("comes with the follow"),
    });
  });

  it("adds the seed once on an unpaired machine, however often it is ensured", async () => {
    const store = new LibraryStore(data, seed);
    await store.ensure();
    seedDeclares2();
    for (let i = 0; i < 3; i++) await store.ensure();
    expect(folders(store)).toEqual(["1", "2"]);
    expect(existsSync(join(store.home, "k7-core", "2", "library.k7x"))).toBe(
      true,
    );
  });
});

describe("the husks a follow left", () => {
  /** A machine that ran the looping hub: versions 2…6 copied, then undone to their folders and `.gitkeep`. */
  async function runaway(): Promise<LibraryStore> {
    const before = new LibraryStore(data, seed);
    await before.ensure();
    for (const v of [2, 3, 4, 5, 6]) {
      mkdirSync(join(before.home, "k7-core", String(v), "samples"), {
        recursive: true,
      });
      mkdirSync(join(before.home, "k7-core", String(v), "modules", "fx"), {
        recursive: true,
      });
      writeFileSync(
        join(before.home, "k7-core", String(v), "samples", ".gitkeep"),
        "",
      );
    }
    return before;
  }

  it("are swept on a followed machine, which keeps the origin's version alone", async () => {
    await runaway();
    const store = new LibraryStore(data, seed, () => true);
    seedDeclares2();
    expect(await store.ensure()).toMatchObject([
      {
        state: "current",
        note: "followed from its origin, 5 empty version folder(s) removed (2, 3, 4, 5, 6)",
      },
    ]);
    expect(folders(store)).toEqual(["1"]);
  });

  it("are swept on an unpaired machine, where the seed then takes its own number", async () => {
    await runaway();
    seedDeclares2();
    const store = new LibraryStore(data, seed);
    expect(await store.ensure()).toMatchObject([
      {
        state: "seeded",
        note: expect.stringMatching(/^version 2 added .*5 empty version/),
      },
    ]);
    expect(folders(store)).toEqual(["1", "2"]);
    expect(store.versions("k7-core").map((m) => m.version)).toEqual([1, 2]);
  });

  it("never take a version holding a file, manifest or not, nor one the follow knows", async () => {
    await runaway();
    const at = join(data, "libraries", "k7-core");
    writeFileSync(join(at, "3", "modules", "fx", "kept.k7x"), "x(1)\n");
    mkdirSync(
      join(data, "libraries", ".sync-follow", "k7-core", "confirmed", "4"),
      {
        recursive: true,
      },
    );
    const store = new LibraryStore(data, seed, () => true);
    await store.ensure();
    expect(folders(store)).toEqual(["1", "3", "4"]);
  });
});
