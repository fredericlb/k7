// `track group` — a group lane over the tracks named, written where a lane goes, and a track already in a group
// taken out of it. Through the dispatcher, asserting the files and the compiled groups.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileNodeProject } from "@studio/song/nodeProject";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const doc = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);
const dataOf = (rel: string) => wsData(join(dir, rel));
const run = async (line: string) => {
  const h = testHost({ songPath: dir, project: () => compileNodeProject(dir) });
  await runCommand(line, h, "cli");
  return h;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "track-group-"));
  dir = join(root, "song.k7");
  doc("project.k7x", { project: { name: "t", tempo: 120 } });
  for (const lane of ["kick", "snare", "bass"]) {
    doc(`tracks/${lane}.k7x`, { extends: "@meta/track", events: [] });
    doc(`chains/${lane}.k7x`, {
      start: true,
      steps: [{ id: `lane-${lane}`, track: lane }, { to: [{ chain: "MIX" }] }],
    });
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("writes a group lane over the tracks, and its chain, named group-N when unnamed", async () => {
  await run("track group kick,snare");
  expect(dataOf("tracks/group-1.k7x")).toEqual({
    extends: "@meta/group-track",
    tracks: ["kick", "snare"],
  });
  expect(existsSync(join(dir, "chains/group-1.k7x"))).toBe(true);
  const p = compileNodeProject(dir);
  expect(p.groups.map((g) => g.id)).toEqual(["group-1"]);
  expect(
    p.tracks
      .filter((t) => t.group === "group-1")
      .map((t) => t.id)
      .sort(),
  ).toEqual(["kick", "snare"]);
});

it("takes a track out of the group it was in", async () => {
  await run("track group kick,snare drums");
  await run("track group snare,bass low");
  expect(dataOf("tracks/drums.k7x").tracks).toEqual(["kick"]);
  expect(dataOf("tracks/low.k7x").tracks).toEqual(["snare", "bass"]);
});

it("refuses a group as a member, and a track that is not there", async () => {
  await run("track group kick,snare drums");
  expect(
    (await run("track group drums,bass")).lines.refuse.join(" "),
  ).toContain("is a group");
  expect((await run("track group nope")).lines.refuse.join(" ")).toContain(
    "no track 'nope'",
  );
  expect(existsSync(join(dir, "tracks/group-1.k7x"))).toBe(false);
});
