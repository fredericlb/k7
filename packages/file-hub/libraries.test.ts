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
  mkdirSync(join(seed, "st0", "modules"), { recursive: true });
  writeFileSync(join(seed, "st0", "modules", "mix.yaml"), "plugin: mixer\n");
  mkdirSync(join(seed, "st0", ".git"));
});

describe("the hub's libraries", () => {
  it("lists the seed's libraries until a list is written, and copies one in on first ask, without its .git", () => {
    const store = new LibraryStore(data, seed);
    expect(store.settings()).toEqual([{ name: "st0" }]);
    expect(store.ensure()).toMatchObject([{ name: "st0", state: "seeded" }]);
    expect(
      readFileSync(join(store.home, "st0", "1", "modules", "mix.yaml"), "utf8"),
    ).toBe("plugin: mixer\n");
    expect(existsSync(join(store.home, "st0", "1", ".git"))).toBe(false);
    expect(store.versions("st0")).toEqual([
      { name: "st0", version: 1, requires: 1 },
    ]);
    expect(store.ensure()).toMatchObject([{ name: "st0", state: "current" }]);
  });

  it("moves a library still in one folder into its version 1, leaving no draft until an admin asks", () => {
    const store = new LibraryStore(data, seed);
    mkdirSync(join(store.home, "st0", "modules"), { recursive: true });
    writeFileSync(join(store.home, "st0", "modules", "old.yaml"), "x: 1\n");
    expect(store.ensure()).toMatchObject([
      { name: "st0", state: "current", note: "moved into version 1" },
    ]);
    expect(
      existsSync(join(store.home, "st0", "1", "modules", "old.yaml")),
    ).toBe(true);
    expect(existsSync(join(store.home, "st0", "draft"))).toBe(false);
    expect(store.ensure({ draft: true })).toMatchObject([
      { name: "st0", note: "draft copied from version 1" },
    ]);
    expect(
      existsSync(join(store.home, "st0", "draft", "modules", "old.yaml")),
    ).toBe(true);
    expect(existsSync(join(store.home, "st0", "draft", "library.yaml"))).toBe(
      false,
    );
  });

  it("publishes the draft as the next version, frozen with its manifest, and refuses a level this st0 cannot run", () => {
    const store = new LibraryStore(data, seed);
    store.ensure({ draft: true });
    writeFileSync(
      join(store.home, "st0", "draft", "modules", "mix.yaml"),
      "plugin: newer\n",
    );
    expect(store.publish("st0", { requires: 99 })).toMatchObject({
      error: expect.stringContaining("level 99"),
    });
    expect(store.publish("st0", { notes: "louder" })).toMatchObject({
      ok: true,
      manifest: { name: "st0", version: 2, notes: "louder" },
    });
    expect(
      readFileSync(join(store.home, "st0", "2", "modules", "mix.yaml"), "utf8"),
    ).toBe("plugin: newer\n");
    expect(
      readFileSync(join(store.home, "st0", "1", "modules", "mix.yaml"), "utf8"),
    ).toBe("plugin: mixer\n");
    expect(store.versions("st0").map((m) => m.version)).toEqual([1, 2]);
    expect(store.publish("drums")).toMatchObject({
      error: "'drums' has no draft to publish",
    });
  });

  it("makes a library the seed does not hold empty, and writes the list", () => {
    const store = new LibraryStore(data, seed);
    const r = store.set([{ name: "st0" }, { name: "drums" }]);
    expect(r).toMatchObject({ ok: true });
    expect(existsSync(join(store.home, "drums"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(data, "libraries.json"), "utf8")),
    ).toEqual({
      libraries: [{ name: "st0" }, { name: "drums" }],
    });
    expect(store.view().libraries).toEqual([
      {
        name: "st0",
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

  it("installs a PUBLISHED seed under its own number, and adds a newer one to a machine that has the library", () => {
    writeFileSync(
      join(seed, "st0", "library.yaml"),
      "name: st0\nversion: 3\nrequires: 1\n",
    );
    const store = new LibraryStore(data, seed);
    expect(store.ensure()).toMatchObject([{ name: "st0", state: "seeded" }]);
    expect(store.versions("st0").map((m) => m.version)).toEqual([3]);
    // An app update carries version 4: one more frozen version, nothing else touched.
    writeFileSync(
      join(seed, "st0", "library.yaml"),
      "name: st0\nversion: 4\nrequires: 1\n",
    );
    expect(store.ensure()).toMatchObject([
      {
        name: "st0",
        state: "seeded",
        note: expect.stringContaining("version 4"),
      },
    ]);
    expect(store.versions("st0").map((m) => m.version)).toEqual([3, 4]);
    expect(store.ensure()).toMatchObject([{ name: "st0", state: "current" }]);
  });

  it("refuses to publish under a name that is no library", () => {
    const store = new LibraryStore(data, seed);
    expect(store.publish("../st0")).toEqual({
      error: "'../st0' names no library",
    });
  });

  it("keeps the folder of a library the list dropped: it is the library, not a copy", () => {
    const store = new LibraryStore(data, seed);
    store.set([{ name: "st0" }, { name: "drums" }]);
    store.set([{ name: "st0" }]);
    expect(store.settings()).toEqual([{ name: "st0" }]);
    expect(existsSync(join(store.home, "drums"))).toBe(true);
  });

  it("reads a list written with repository URIs by its names", () => {
    mkdirSync(data, { recursive: true });
    writeFileSync(
      join(data, "libraries.json"),
      JSON.stringify({
        libraries: [{ name: "st0", uri: "git@example.test:s/st0.git" }],
      }),
    );
    expect(new LibraryStore(data).settings()).toEqual([{ name: "st0" }]);
  });

  it("takes a seed naming its libraries, as a desktop names the submodule's folder", () => {
    expect(parseSeed(`st0=${join(seed, "st0")}, Bad=x`)).toEqual(
      new Map([["st0", join(seed, "st0")]]),
    );
    const store = new LibraryStore(data, `st0=${join(seed, "st0")}`);
    expect(store.ensure()).toMatchObject([{ name: "st0", state: "seeded" }]);
  });

  it("validates a list before anything is made", () => {
    expect(settingsProblem([{ name: "Bad Name" }])).toMatch(
      /cannot name a library/,
    );
    expect(settingsProblem([{ name: "st0" }, { name: "st0" }])).toMatch(
      /two libraries/,
    );
    const store = new LibraryStore(data, seed);
    expect(store.set([{ name: "engine" }])).toHaveProperty("error");
    expect(existsSync(join(data, "libraries.json"))).toBe(false);
  });
});
