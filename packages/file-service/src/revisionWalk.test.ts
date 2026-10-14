// The revision token is now derived from two DIFFERENT walks, and they must not drift.
//
// `/revision` — polled every two seconds, per tab — takes a narrow walk that stats the project's
// sources alone. A journalled mutation takes a wide one, because it also needs every file's size
// and mtime to diff what the write did, and names the instant off that. One derivation reads
// both (`Workspace.revisionOf`), and this is what proves the two agree: every memo in the
// service is keyed on this string, so a token that means one thing to the poll and another to a
// command is a cache that serves the wrong song, confidently.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeModule, writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let proj: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fs-rev-"));
  proj = join(root, "song.k7");
  mkdirSync(join(proj, "nodes"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  writeFileSync(join(proj, "graph.yaml"), "modules:\n  gtr: [ OUT ]\n", "utf8");
  writeFileSync(
    join(proj, "nodes", "gtr.yaml"),
    'extends: "@meta/track"\nevents: []\n',
    "utf8",
  );
  writeModule(proj, "audio", "amp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  ws = new Workspace(root);
  ws.setActiveProject("song.k7");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** The token off the WIDE walk — the one a journalled mutation takes. */
const wide = async (): Promise<string> =>
  (await ws.recordChange("probe", () => {})).after;

describe("the revision token, from either walk", () => {
  it("says the same thing to a poll and to a mutation", async () => {
    expect(await wide()).toBe(ws.revision().rev);
  });

  it("still ignores media — a wav is walked now, and must not be counted", async () => {
    const narrowBefore = ws.revision().rev;
    // The wide walk sees this file and the narrow one never did; a leak into the token would show here.
    writeFileSync(join(proj, "take.wav"), Buffer.alloc(64));
    expect(ws.revision().rev).toBe(narrowBefore);
    expect(await wide()).toBe(narrowBefore);
  });

  it("still moves for a source, whichever walk saw it", async () => {
    const was = ws.revision().rev;
    await new Promise((r) => setTimeout(r, 12)); // mtime resolution
    writeFileSync(
      join(proj, "graph.yaml"),
      "modules:\n  gtr: [ amp ]\n",
      "utf8",
    );
    const now = ws.revision().rev;
    expect(now).not.toBe(was);
    expect(await wide()).toBe(now);
  });
});

describe("what a journalled mutation answers", () => {
  it("brackets a write with two different tokens", async () => {
    const r = await ws.recordChange("write", async () => {
      await new Promise((res) => setTimeout(res, 12));
      writeFileSync(
        join(proj, "graph.yaml"),
        "modules:\n  gtr: [ amp ]\n",
        "utf8",
      );
      return "done";
    });
    expect(r.value).toBe("done");
    expect(r.after).not.toBe(r.before);
  });

  it("gives one token twice when nothing was written", async () => {
    const r = await ws.recordChange("noop", () => {});
    expect(r.after).toBe(r.before);
  });
});
