import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

// The Workspace CACHES the compiled project, keyed on `revision()` and not on its own writes — docs/workspace.md.

const here = dirname(fileURLToPath(import.meta.url)); // packages/file-service/src
const DEMOS = join(here, "..", "..", "..", "demos");
const SONG = join(DEMOS, "synth-demo.st0");

let root: string;
let proj: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-reopen-"));
  proj = join(root, "song.st0");
  cpSync(SONG, proj, { recursive: true });
  // The demo's own modules live at `@workspace`, its sibling in the Examples workspace.
  const demoModules = join(DEMOS, "_modules");
  if (existsSync(demoModules))
    cpSync(demoModules, join(root, "_modules"), { recursive: true });
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a project changed underneath the Workspace", () => {
  // Recolouring a track lands in the COMPILED doc directly, which is the thing that is cached.
  const setColor = (c: string): void => {
    writeFileSync(
      join(proj, "nodes", "melody.yaml"),
      `extends: "@meta/track"\ncolor: "${c}"\nevents:\n  - { ref: melody, start: "1:1:1" }\n`,
      "utf8",
    );
  };
  const colour = (): string | undefined =>
    ws.cachedProjectDoc(proj).tracks.find((t) => t.id === "melody")?.color;

  it("picks up an out-of-band edit with no reopen at all", () => {
    // Without this, every derived view describes confidently a project the files on screen contradict.
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
