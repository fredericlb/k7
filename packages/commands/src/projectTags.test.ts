// `project tag` / `project untag` — what the tasks panel runs. Through the dispatcher and asserting the FILE.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];

beforeEach(() => {
  logs.length = 0;
  dir = mkdtempSync(join(tmpdir(), "td-ptags-"));
  writeFileSync(join(dir, "project.yaml"), "project:\n  name: t\n", "utf8");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [], masterPlugins: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;

const tags = () =>
  parse(readFileSync(join(dir, "project.yaml"), "utf8")).project.tags;

describe("project tag", () => {
  it("adds a tag once, whatever its case, and keeps spaces", async () => {
    await runCommand("project tag to mix", host(), "cli");
    await runCommand("project tag Live", host(), "cli");
    await runCommand("project tag live", host(), "cli");
    expect(tags()).toEqual(["to mix", "Live"]);
  });

  it("removes a tag, and the key with the last one", async () => {
    await runCommand("project tag live", host(), "cli");
    await runCommand("project tag demo", host(), "cli");
    await runCommand("project untag LIVE", host(), "cli");
    expect(tags()).toEqual(["demo"]);
    await runCommand("project untag demo", host(), "cli");
    expect(tags()).toBeUndefined();
  });

  it("lists them when bare", async () => {
    await runCommand("project tag live", host(), "cli");
    logs.length = 0;
    await runCommand("project tag", host(), "cli");
    expect(logs).toEqual(["live"]);
  });
});
