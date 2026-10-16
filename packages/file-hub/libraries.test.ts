// The hub's LibraryStore: the list validated and written, each library's folder copied once from the
// seed or made empty, a dropped library's folder kept, and the list read from disk until one is written.
// See docs/fileHub.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { LibraryStore, parseSeed, settingsProblem } from "./libraries.ts";

let data: string;
let seed: string;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "hub-libs-"));
  data = join(tmp, "data");
  seed = join(tmp, "seed");
  mkdirSync(join(seed, "k7-core", "modules"), { recursive: true });
  writeFileSync(
    join(seed, "k7-core", "modules", "mix.yaml"),
    "plugin: mixer\n",
  );
  mkdirSync(join(seed, "k7-core", ".git"));
});

describe("the hub's libraries", () => {
  it("lists the seed's libraries until a list is written, and copies one in on first ask, without its .git", async () => {
    const store = new LibraryStore(data, seed);
    expect(store.settings()).toEqual([{ name: "k7-core" }]);
    expect(await store.ensure()).toMatchObject([
      { name: "k7-core", state: "seeded" },
    ]);
    expect(
      readFileSync(
        join(store.home, "k7-core", "1", "modules", "mix.yaml"),
        "utf8",
      ),
    ).toBe("plugin: mixer\n");
    expect(existsSync(join(store.home, "k7-core", "1", ".git"))).toBe(false);
    expect(store.versions("k7-core")).toEqual([
      { name: "k7-core", version: 1, requires: 1 },
    ]);
    expect(await store.ensure()).toMatchObject([
      { name: "k7-core", state: "current" },
    ]);
  });

  it("moves a library still in one folder into its version 1, leaving no draft until an admin asks", async () => {
    const store = new LibraryStore(data, seed);
    mkdirSync(join(store.home, "k7-core", "modules"), { recursive: true });
    writeFileSync(join(store.home, "k7-core", "modules", "old.yaml"), "x: 1\n");
    expect(await store.ensure()).toMatchObject([
      { name: "k7-core", state: "current", note: "moved into version 1" },
    ]);
    expect(
      existsSync(join(store.home, "k7-core", "1", "modules", "old.yaml")),
    ).toBe(true);
    expect(existsSync(join(store.home, "k7-core", "draft"))).toBe(false);
    expect(await store.ensure({ draft: true })).toMatchObject([
      { name: "k7-core", note: "draft copied from version 1" },
    ]);
    expect(
      existsSync(join(store.home, "k7-core", "draft", "modules", "old.yaml")),
    ).toBe(true);
    expect(
      existsSync(join(store.home, "k7-core", "draft", "library.yaml")),
    ).toBe(false);
  });

  it("publishes the draft as the next version, frozen with its manifest, and refuses a level this k7 cannot run", async () => {
    const store = new LibraryStore(data, seed);
    await store.ensure({ draft: true });
    writeFileSync(
      join(store.home, "k7-core", "draft", "modules", "mix.yaml"),
      "plugin: newer\n",
    );
    expect(await store.publish("k7-core", { requires: 99 })).toMatchObject({
      error: expect.stringContaining("level 99"),
    });
    expect(await store.publish("k7-core", { notes: "louder" })).toMatchObject({
      ok: true,
      manifest: { name: "k7-core", version: 2, notes: "louder" },
    });
    expect(
      readFileSync(
        join(store.home, "k7-core", "2", "modules", "mix.yaml"),
        "utf8",
      ),
    ).toBe("plugin: newer\n");
    expect(
      readFileSync(
        join(store.home, "k7-core", "1", "modules", "mix.yaml"),
        "utf8",
      ),
    ).toBe("plugin: mixer\n");
    expect(store.versions("k7-core").map((m) => m.version)).toEqual([1, 2]);
    expect(await store.publish("drums")).toMatchObject({
      error: "'drums' has no draft to publish",
    });
  });

  // The copies are asynchronous, so two asked at once must still land as two versions, not one collision.
  it("seeds once and numbers two publishes apart when they are asked for at the same moment", async () => {
    const store = new LibraryStore(data, seed);
    const [a, b] = await Promise.all([store.ensure(), store.ensure()]);
    expect(a).toMatchObject([{ name: "k7-core", state: "seeded" }]);
    expect(b).toMatchObject([{ name: "k7-core", state: "current" }]);
    await store.ensure({ draft: true });
    const both = await Promise.all([
      store.publish("k7-core"),
      store.publish("k7-core"),
    ]);
    expect(both).toMatchObject([
      { ok: true, manifest: { version: 2 } },
      { ok: true, manifest: { version: 3 } },
    ]);
    expect(store.versions("k7-core").map((m) => m.version)).toEqual([1, 2, 3]);
  });

  it("makes a library the seed does not hold empty, and writes the list", async () => {
    const store = new LibraryStore(data, seed);
    const r = await store.set([{ name: "k7-core" }, { name: "drums" }]);
    expect(r).toMatchObject({ ok: true });
    expect(existsSync(join(store.home, "drums"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(data, "libraries.json"), "utf8")),
    ).toEqual({
      libraries: [{ name: "k7-core" }, { name: "drums" }],
    });
    expect(store.view().libraries).toEqual([
      {
        name: "k7-core",
        present: true,
        versions: [{ version: 1, requires: 1 }],
        draft: false,
      },
      {
        name: "drums",
        present: true,
        versions: [{ version: 1, requires: 1 }],
        draft: false,
      },
    ]);
  });

  it("installs a PUBLISHED seed under its own number, and adds a newer one to a machine that has the library", async () => {
    writeFileSync(
      join(seed, "k7-core", "library.yaml"),
      "name: k7-core\nversion: 3\nrequires: 1\n",
    );
    const store = new LibraryStore(data, seed);
    expect(await store.ensure()).toMatchObject([
      { name: "k7-core", state: "seeded" },
    ]);
    expect(store.versions("k7-core").map((m) => m.version)).toEqual([3]);
    // An app update carries version 4: one more frozen version, nothing else touched.
    writeFileSync(
      join(seed, "k7-core", "library.yaml"),
      "name: k7-core\nversion: 4\nrequires: 1\n",
    );
    expect(await store.ensure()).toMatchObject([
      {
        name: "k7-core",
        state: "seeded",
        note: expect.stringContaining("version 4"),
      },
    ]);
    expect(store.versions("k7-core").map((m) => m.version)).toEqual([3, 4]);
    expect(await store.ensure()).toMatchObject([
      { name: "k7-core", state: "current" },
    ]);
  });

  it("refuses to publish under a name that is no library", async () => {
    const store = new LibraryStore(data, seed);
    expect(await store.publish("../k7")).toEqual({
      error: "'../k7' names no library",
    });
  });

  it("keeps the folder of a library the list dropped: it is the library, not a copy", async () => {
    const store = new LibraryStore(data, seed);
    await store.set([{ name: "k7-core" }, { name: "drums" }]);
    await store.set([{ name: "k7-core" }]);
    expect(store.settings()).toEqual([{ name: "k7-core" }]);
    expect(existsSync(join(store.home, "drums"))).toBe(true);
  });

  it("reads a list written with repository URIs by its names", () => {
    mkdirSync(data, { recursive: true });
    writeFileSync(
      join(data, "libraries.json"),
      JSON.stringify({
        libraries: [{ name: "k7-core", uri: "git@example.test:s/k7.git" }],
      }),
    );
    expect(new LibraryStore(data).settings()).toEqual([{ name: "k7-core" }]);
  });

  it("takes a seed naming its libraries, as a desktop names the submodule's folder", async () => {
    expect(parseSeed(`k7-core=${join(seed, "k7-core")}, Bad=x`)).toEqual(
      new Map([["k7-core", join(seed, "k7-core")]]),
    );
    const store = new LibraryStore(data, `k7-core=${join(seed, "k7-core")}`);
    expect(await store.ensure()).toMatchObject([
      { name: "k7-core", state: "seeded" },
    ]);
  });

  it("validates a list before anything is made", async () => {
    expect(settingsProblem([{ name: "Bad Name" }])).toMatch(
      /cannot name a library/,
    );
    expect(settingsProblem([{ name: "k7-core" }, { name: "k7-core" }])).toMatch(
      /two libraries/,
    );
    const store = new LibraryStore(data, seed);
    expect(await store.set([{ name: "engine" }])).toHaveProperty("error");
    expect(existsSync(join(data, "libraries.json"))).toBe(false);
  });
});
