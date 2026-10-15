// libraryPins.test.ts — a workspace's pins are written once: what it already hears, the newest
// runnable version for a new one, the draft for an admin's, and never again after that.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLibraryPins } from "./libraryPins.ts";

const env = process.env.STUDIO_LIBRARIES_HOME;
let home: string;
let ws: string;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "pins-"));
  home = join(tmp, "libraries");
  ws = join(tmp, "ws");
  mkdirSync(ws);
  for (const [v, requires] of [
    ["1", 1],
    ["2", 1],
    ["3", 99],
  ] as const) {
    mkdirSync(join(home, "k7-core", v), { recursive: true });
    writeFileSync(
      join(home, "k7-core", v, "library.yaml"),
      `name: k7-core\nversion: ${v}\nrequires: ${requires}\n`,
    );
  }
  process.env.STUDIO_LIBRARIES_HOME = home;
});

afterEach(() => {
  process.env.STUDIO_LIBRARIES_HOME = env;
});

const pinsText = () => readFileSync(join(ws, "_library-pins.yaml"), "utf8");

describe("ensureLibraryPins", () => {
  it("pins an existing workspace at version 1, what it already hears", () => {
    expect(ensureLibraryPins(ws, { fresh: false, admin: false })).toEqual({
      "k7-core": 1,
    });
    expect(pinsText()).toBe("k7-core: 1\n");
  });

  it("pins a new workspace at the newest version this k7 runs, skipping one that needs a higher level", () => {
    expect(ensureLibraryPins(ws, { fresh: true, admin: false })).toEqual({
      "k7-core": 2,
    });
  });

  it("pins an admin's workspace at the draft, and never rewrites pins it already has", () => {
    expect(ensureLibraryPins(ws, { fresh: false, admin: true })).toEqual({
      "k7-core": "draft",
    });
    expect(ensureLibraryPins(ws, { fresh: true, admin: false })).toBeNull();
    expect(pinsText()).toBe("k7-core: draft\n");
  });
});
