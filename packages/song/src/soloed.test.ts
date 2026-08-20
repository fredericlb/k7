// `soloed:` at project.yaml's root IS the mixer's solo: the compiler stamps the flag onto the
// listed lanes' TrackDocs, and the ENGINE resolves the relationship (any soloed track silences
// every non-soloed one — applySoloMute). Several at once is the point; absent is nobody.

import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "node-demo.st0",
);

let dir: string;
const solo = (ids: string[]) =>
  appendFileSync(
    join(dir, "project.yaml"),
    `soloed: [${ids.join(", ")}]\n`,
    "utf8",
  );
const tracks = () => compileNodeProject(dir).tracks;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-solo-"));
  cpSync(SONG, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("soloed, compiled", () => {
  it("stamps the listed lanes and nobody else", () => {
    solo(["drums"]);
    const byId = new Map(tracks().map((t) => [t.id, t.solo]));
    expect(byId.get("drums")).toBe(true);
    for (const [id, s] of byId) if (id !== "drums") expect(s).toBe(false);
  });

  it("holds SEVERAL lanes at once", () => {
    const ids = tracks()
      .slice(0, 2)
      .map((t) => t.id);
    solo(ids);
    const byId = new Map(tracks().map((t) => [t.id, t.solo]));
    for (const id of ids) expect(byId.get(id)).toBe(true);
  });

  it("compiles nobody soloed when the key is absent — every song ever written", () => {
    expect(tracks().every((t) => !t.solo)).toBe(true);
  });

  it("treats an unknown name as inert, like a bypassed entry nothing carries", () => {
    solo(["nonsense"]);
    expect(tracks().every((t) => !t.solo)).toBe(true);
  });

  it("is refused by the schema when it is not a list of names", () => {
    writeFileSync(
      join(dir, "project.yaml"),
      `${readFileSync(join(dir, "project.yaml"), "utf8")}soloed: drums\n`,
      "utf8",
    );
    expect(() => compileNodeProject(dir)).toThrow(/soloed/);
  });
});
