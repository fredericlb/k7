import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

// This was staleOverlay.test.ts, whose subject was the generated schema.gen.cue overlays: an
// INPUT to every CUE compile, pinning a chain step to the modules that existed when they
// were written, so adding an entity made the next read fail against a vocabulary that
// predated it. There are no overlays now, and nothing to heal.
//
// What survives is the reason those tests could observe anything at all: the Workspace
// CACHES the compiled project, and nothing tells it when the files change underneath. No
// watcher — so a read that follows nothing keeps the project it has. Opening the project is
// the signal, which is what the browser does on /open and why a reopen fixes a project that
// looks wrong.

const here = dirname(fileURLToPath(import.meta.url)); // packages/file-service/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "apps",
  "capot",
  "songs",
  "synth-demo",
);

let root: string;
let proj: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-reopen-"));
  proj = join(root, "song");
  cpSync(SONG, proj, { recursive: true });
  ws = new Workspace(root);
  ws.setActiveProject("song");
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
  // The COMPILED doc is what's cached (cachedProjectDoc) — the graph is re-read per call, so
  // it isn't the thing to ask. Adding a module changes nothing the compiled doc shows until
  // it's in a chain, so these recolour a track instead: it lands in the doc directly.
  const setColor = (c: string): void => {
    writeFileSync(
      join(proj, "tracks", "melody.yaml"),
      `type: single\ncontentType: sequences\ncolor: "${c}"\nclips:\n  - { ref: melody, start: "1:1:1" }\n`,
      "utf8",
    );
  };
  const colour = (): string | undefined =>
    ws.cachedProjectDoc(proj).tracks.find((t) => t.id === "melody")?.color;

  it("serves the cached project on a read that follows no change", () => {
    // Why the invalidation has to be explicit: re-compiling a large song on every poll is
    // the cost this avoids. There is no watcher, so an edit nobody announced is not seen.
    const before = colour();
    setColor("#123456");
    expect(colour()).toBe(before);
  });

  it("picks up an out-of-band edit when the project is reopened", () => {
    // A `git pull`, another tab, a hand-edited file: nothing tells this Workspace. Opening
    // the project is the signal — which is what the browser does on /open, and why a reopen
    // fixes a project that looks wrong.
    setColor("#123456");
    ws.setActiveProject("song");
    expect(colour()).toBe("#123456");
  });

  it("also picks it up on an explicit invalidation", () => {
    setColor("#abcdef");
    ws.invalidateProjectDoc();
    expect(colour()).toBe("#abcdef");
  });
});
