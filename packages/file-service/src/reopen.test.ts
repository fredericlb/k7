import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

// The Workspace CACHES the compiled project, keyed on `revision()` and not on its own writes — docs/workspace.md.

const here = dirname(fileURLToPath(import.meta.url)); // packages/file-service/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.st0",
);

let root: string;
let proj: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-reopen-"));
  proj = join(root, "song.st0");
  cpSync(SONG, proj, { recursive: true });
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Add a module the project didn't have, without telling the Workspace. */
function addModuleOutOfBand(name: string): void {
  const folder = join(proj, "modules", "instruments", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "module.yaml"),
    "extends: instruments/fourosc\n",
    "utf8",
  );
}

describe("a project changed underneath the Workspace", () => {
  // Recolouring a track lands in the COMPILED doc directly, which is the thing that is cached.
  const setColor = (c: string): void => {
    writeFileSync(
      join(proj, "nodes", "melody.yaml"),
      `extends: "@studio/track"\ncolor: "${c}"\nevents:\n  - { ref: melody, start: "1:1:1" }\n`,
      "utf8",
    );
  };
  const colour = (): string | undefined =>
    ws.cachedProjectDoc(proj).tracks.find((t) => t.id === "melody")?.color;

  it("picks up an out-of-band edit with no reopen at all", () => {
    // Every derived view used to describe, confidently, a project the files on screen contradicted.
    colour(); // fill the memo first, so a stale hit would be the failure
    setColor("#123456");
    expect(colour()).toBe("#123456");
  });

  it("still serves the memo when nothing changed", () => {
    // Same revision, same object: the token's 4.8 ms walk against the ~280 ms it saves.
    expect(ws.cachedProjectDoc(proj)).toBe(ws.cachedProjectDoc(proj));
  });

  it("picks up an out-of-band edit when the project is reopened", () => {
    // Reopening is still A signal: `/open` must not serve something older than what it just opened.
    setColor("#123456");
    ws.setActiveProject("song.st0");
    expect(colour()).toBe("#123456");
  });

  it("also picks it up on an explicit invalidation", () => {
    setColor("#abcdef");
    ws.invalidateProjectDoc();
    expect(colour()).toBe("#abcdef");
  });
});
