// librariesLegacy.test.ts — a deployment from before k7 lists its default library as `st0`: at start the hub
// renames it `k7-core`, its folder and its sync state with it, once. See docs/fileHub.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LibraryStore } from "./libraries.ts";

const deployment = (names: string[]) => {
  const root = mkdtempSync(join(tmpdir(), "libs-legacy-"));
  writeFileSync(
    join(root, "libraries.json"),
    JSON.stringify({ libraries: names.map((name) => ({ name })) }),
  );
  for (const n of names) {
    mkdirSync(join(root, "libraries", n, "1"), { recursive: true });
    mkdirSync(join(root, "libraries", ".sync-relay", n), { recursive: true });
  }
  return root;
};

describe("the default library from before k7", () => {
  it("becomes k7-core: the list, the folder and the relay's room", () => {
    const root = deployment(["st0", "drums"]);
    const store = new LibraryStore(root, "");
    expect(store.renameLegacyDefault()).toBe(true);
    expect(store.settings().map((l) => l.name)).toEqual(["k7-core", "drums"]);
    expect(existsSync(join(root, "libraries", "k7-core", "1"))).toBe(true);
    expect(existsSync(join(root, "libraries", "st0"))).toBe(false);
    expect(existsSync(join(root, "libraries", ".sync-relay", "k7-core"))).toBe(
      true,
    );
    // Once: a second start finds nothing to do.
    expect(store.renameLegacyDefault()).toBe(false);
  });

  it("leaves a list that names k7-core already as it is", () => {
    const root = deployment(["st0", "k7-core"]);
    const before = readFileSync(join(root, "libraries.json"), "utf8");
    expect(new LibraryStore(root, "").renameLegacyDefault()).toBe(false);
    expect(readFileSync(join(root, "libraries.json"), "utf8")).toBe(before);
  });
});
