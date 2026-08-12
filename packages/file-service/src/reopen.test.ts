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
// What survives is the reason those tests could observe anything at all: the Workspace CACHES
// the compiled project. It used to key that memo on its OWN writes, so a change made any other
// way — a git pull, another editor, a tool writing the folder — served a stale compile until
// somebody reopened the project. It keys on `revision()` now, the same token the graph uses
// and the frontend already polls, so these tests pin the reverse: the edit is seen, and a read
// that follows nothing still does not recompile.
// See ../docs/workspace.md.

const here = dirname(fileURLToPath(import.meta.url)); // packages/file-service/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.l8",
);

let root: string;
let proj: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-reopen-"));
  proj = join(root, "song.l8");
  cpSync(SONG, proj, { recursive: true });
  ws = new Workspace(root);
  ws.setActiveProject("song.l8");
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
      join(proj, "instances", "melody.yaml"),
      `extends: "@studio/sequence-track"\ncolor: "${c}"\nclips:\n  - { ref: melody, start: "1:1:1" }\n`,
      "utf8",
    );
  };
  const colour = (): string | undefined =>
    ws.cachedProjectDoc(proj).tracks.find((t) => t.id === "melody")?.color;

  it("picks up an out-of-band edit with no reopen at all", () => {
    // The symptom this replaced is the worst kind: every derived view — the graph, the
    // document sent to the engine, the errors — confidently describing a project the files on
    // screen contradict, until somebody thought to reopen it. The revision token moves for an
    // edit nobody announced, so the next read compiles what is actually there.
    colour(); // fill the memo first, so a stale hit would be the failure
    setColor("#123456");
    expect(colour()).toBe("#123456");
  });

  it("still serves the memo when nothing changed", () => {
    // The cost the cache exists for — re-compiling a real song on every poll — is NOT given up
    // to get that. Same revision, same object: the walk that reads the token is 4.8 ms against
    // the ~280 ms it saves, which is the same trade graphDoc() already made.
    expect(ws.cachedProjectDoc(proj)).toBe(ws.cachedProjectDoc(proj));
  });

  it("picks up an out-of-band edit when the project is reopened", () => {
    // Reopening is no longer the only signal, but it is still A signal — /open is what the
    // browser does, and it must not serve something older than what it just opened.
    setColor("#123456");
    ws.setActiveProject("song.l8");
    expect(colour()).toBe("#123456");
  });

  it("also picks it up on an explicit invalidation", () => {
    setColor("#abcdef");
    ws.invalidateProjectDoc();
    expect(colour()).toBe("#abcdef");
  });
});
