// libraryFirstEnsure.test.ts — the hub's first ensure runs once and is shared: the standalone
// backend waits on it before it listens, and an ensure asked meanwhile ends after its copy.

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LibraryStore } from "./libraries.ts";

function seeded(): { data: string; seed: string } {
  const tmp = mkdtempSync(join(tmpdir(), "hub-first-"));
  const seed = join(tmp, "seed");
  mkdirSync(join(seed, "k7-core", "modules"), { recursive: true });
  writeFileSync(
    join(seed, "k7-core", "modules", "mix.k7x"),
    'plugin("mixer")\n',
  );
  return { data: join(tmp, "data"), seed };
}

describe("LibraryStore.firstEnsure", () => {
  it("copies the seed once, however many callers wait on it", async () => {
    const { data, seed } = seeded();
    const store = new LibraryStore(data, seed);
    const a = store.firstEnsure();
    expect(store.firstEnsure()).toBe(a);
    expect(await a).toMatchObject([{ name: "k7-core", state: "seeded" }]);
    expect(await store.firstEnsure()).toMatchObject([
      { name: "k7-core", state: "seeded" },
    ]);
  });

  it("holds an ensure asked during the first copy until the library is on disk", async () => {
    const { data, seed } = seeded();
    const store = new LibraryStore(data, seed);
    void store.firstEnsure();
    // What a file service's askHubSync runs: queued behind the copy, so it finds the library there.
    const notes = await store.ensure();
    expect(existsSync(join(store.home, "k7-core", "1", "modules"))).toBe(true);
    expect(notes).toMatchObject([{ name: "k7-core", state: "current" }]);
  });
});
