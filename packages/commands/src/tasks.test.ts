// The task verbs, through the dispatcher, on a real workspace folder: TODOS.md written at its root, a
// `task mark` naming the project it was run in, and numbers that refuse when there is no such task.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
const song = () => join(root, "05.paradoxe.k7");
const todos = () => readFileSync(join(root, "TODOS.md"), "utf8");
const run = async (line: string, noWorkspace = false) => {
  const h = testHost({
    repoDir: noWorkspace ? undefined : root,
    songPath: song(),
    project: () =>
      ({
        tracks: [],
        timeSigNumerator: 4,
        timeSigDenominator: 4,
      }) as unknown as ProjectDoc,
  });
  await runCommand(line, h, "cli");
  return h;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tasks-"));
  mkdirSync(song());
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("task verbs", () => {
  it("adds, marks, ticks and removes, in the workspace's TODOS.md", async () => {
    await run("task add bounce the bass");
    await run("task mark 49:1 fix the snare");
    expect(todos()).toBe(
      "# Tasks\n\n- [ ] bounce the bass\n- [ ] fix the snare `05.paradoxe.k7 @ 49:1`\n",
    );
    await run("task done 2");
    expect(todos()).toContain("- [x] fix the snare");
    await run("task remove 1");
    expect(todos()).toBe(
      "# Tasks\n\n- [x] fix the snare `05.paradoxe.k7 @ 49:1`\n",
    );
  });

  it("keeps what a person wrote around the tasks", async () => {
    writeFileSync(join(root, "TODOS.md"), "# Ours\n\nprose\n", "utf8");
    await run("task add one more");
    expect(todos()).toBe("# Ours\n\nprose\n- [ ] one more\n");
  });

  it("refuses a missing task, a bad timecode, and having no workspace", async () => {
    expect((await run("task done 3")).lines.refuse.join(" ")).toMatch(
      /no task 3/,
    );
    expect((await run("task mark nope fix")).lines.refuse.join(" ")).toMatch(
      /timecode/,
    );
    expect((await run("task add x", true)).lines.refuse.join(" ")).toMatch(
      /no workspace/,
    );
  });
});
