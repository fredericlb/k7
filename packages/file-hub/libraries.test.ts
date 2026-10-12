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
      readFileSync(join(store.home, "st0", "modules", "mix.yaml"), "utf8"),
    ).toBe("plugin: mixer\n");
    expect(existsSync(join(store.home, "st0", ".git"))).toBe(false);
    expect(store.ensure()).toMatchObject([{ name: "st0", state: "current" }]);
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
      { name: "st0", present: true },
      { name: "drums", present: true },
    ]);
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
