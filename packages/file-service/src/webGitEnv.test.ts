// A web commit into a CLONED workspace: no repo-local identity, no global one visible.
// The hosted container is exactly that, and the commit failed with "Please tell me who you are".

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAndPush } from "@studio/commands/git";
import { afterEach, beforeEach, expect, it } from "vitest";
import { webGitEnv } from "./engineLink.ts";

let dir: string;
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fs-webgit-"));
  // What the container has: no global or system config, so no identity anywhere.
  process.env.GIT_CONFIG_GLOBAL = join(dir, "no-global");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  for (const k of Object.keys(process.env))
    if (/^(GIT_(AUTHOR|COMMITTER)_|EMAIL$)/.test(k)) delete process.env[k];
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

it("commits as the editing account in a repo that has no identity", () => {
  writeFileSync(join(dir, "a.txt"), "x\n");
  const r = commitAndPush(dir, "delete 03", webGitEnv("fred@example.com"));
  expect(r.sha).toBeTruthy();
  const who = execFileSync(
    "git",
    ["log", "-1", "--format=%an <%ae>|%cn <%ce>"],
    { cwd: dir, encoding: "utf8" },
  ).trim();
  expect(who).toBe("fred <fred@example.com>|fred <fred@example.com>");
});
