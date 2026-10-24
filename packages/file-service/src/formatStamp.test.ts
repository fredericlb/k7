// A lane saved through the file service with an event in SECONDS raises its project's format level, and
// one saved without leaves it alone — song/src/formatStamp.ts, song-schema docs/formatLevel.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatLevelOfText } from "@studio/song-schema/formatLevel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let dir: string;
const level = () =>
  formatLevelOfText(readFileSync(join(dir, "proj.k7", "project.k7x"), "utf8"));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-fmtstamp-"));
  mkdirSync(join(dir, "proj.k7", "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "proj.k7", "project.k7x"),
    'project({ name: "p", tempo: 120 })\n',
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a lane write", () => {
  it("stamps format(2) when it places an event in seconds", () => {
    new Workspace(dir).write(
      "proj.k7/nodes/fx.k7x",
      'extends("@meta/track")\nevents([ref("a").start(2.5)])\n',
    );
    expect(level()).toBe(2);
  });

  it("leaves a musical lane's project at level 1", () => {
    new Workspace(dir).write(
      "proj.k7/nodes/fx.k7x",
      'extends("@meta/track")\nevents([ref("a").start("2:1")])\n',
    );
    expect(level()).toBeNull();
  });
});
