// `track group` — a group lane over the tracks named, written where a lane goes, and a track already in a group
// taken out of it. Through the dispatcher, asserting the files and the compiled groups.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileNodeProject } from "@studio/song/nodeProject";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};
const yamlOf = (rel: string) => parse(readFileSync(join(dir, rel), "utf8"));
const run = async (line: string) => {
  const h = testHost({ songPath: dir, project: () => compileNodeProject(dir) });
  await runCommand(line, h, "cli");
  return h;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "track-group-"));
  dir = join(root, "song.k7");
  put("project.yaml", "project:\n  name: t\n  tempo: 120\n");
  for (const lane of ["kick", "snare", "bass"]) {
    put(`tracks/${lane}.yaml`, 'extends: "@meta/track"\nevents: []\n');
    put(
      `chains/${lane}.yaml`,
      `start: true\nsteps:\n  - { id: lane-${lane}, track: ${lane} }\n  - to: [ { chain: MIX } ]\n`,
    );
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("writes a group lane over the tracks, and its chain, named group-N when unnamed", async () => {
  await run("track group kick,snare");
  expect(yamlOf("tracks/group-1.yaml")).toEqual({
    extends: "@meta/group-track",
    tracks: ["kick", "snare"],
  });
  expect(existsSync(join(dir, "chains/group-1.yaml"))).toBe(true);
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
  expect(yamlOf("tracks/drums.yaml").tracks).toEqual(["kick"]);
  expect(yamlOf("tracks/low.yaml").tracks).toEqual(["snare", "bass"]);
});

it("refuses a group as a member, and a track that is not there", async () => {
  await run("track group kick,snare drums");
  expect(
    (await run("track group drums,bass")).lines.refuse.join(" "),
  ).toContain("is a group");
  expect((await run("track group nope")).lines.refuse.join(" ")).toContain(
    "no track 'nope'",
  );
  expect(existsSync(join(dir, "tracks/group-1.yaml"))).toBe(false);
});
