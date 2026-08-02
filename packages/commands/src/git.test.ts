import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAlternative,
  cancelAlternative,
  currentBranch,
  isDirty,
  newAlternative,
  switchAlternative,
} from "./git";

// An alternative is a branch you try a direction on. The three verbs that END one — apply, cancel, switch —
// each decide what happens to work you have not committed, and they must agree: `switch` commits it, so
// `apply` does too. Refusing with "commit them first" sent you off to run a second command that would only
// have produced this same commit, and the edits being applied are usually the last ones you made.
//
// A real repo, because every one of these is a git behaviour: what a stub would prove is that the stub agrees
// with itself.

let dir: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const song = () => join(dir, "song.yaml");
const on = (branch: string) => currentBranch(dir) === branch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-alt-"));
  git("init", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  // The host's global config turns LF into CRLF on checkout. These assertions compare file CONTENT to prove a
  // merge carried it, so the fixture opts out — otherwise they measure the line-ending setting, not the merge.
  git("config", "core.autocrlf", "false");
  writeFileSync(song(), "tempo: 120\n");
  git("add", "-A");
  git("commit", "-m", "first");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("applying an alternative", () => {
  it("commits work in progress instead of refusing, and merges it", () => {
    newAlternative(dir, "faster");
    writeFileSync(song(), "tempo: 140\n"); // …and never committed
    expect(isDirty(dir)).toBe(true);

    const r = applyAlternative(dir);

    expect(r).toMatchObject({ alt: "faster", parent: "main" });
    expect(r.wip).toMatch(/^wip /); // named, so the log can say where the edits went
    expect(on("main")).toBe(true);
    // The whole point: the uncommitted edit is in the parent now, not stranded on the alternative.
    expect(readFileSync(song(), "utf8")).toBe("tempo: 140\n");
    expect(isDirty(dir)).toBe(false);
  });

  it("says nothing about a wip when the tree was already clean", () => {
    newAlternative(dir, "faster");
    writeFileSync(song(), "tempo: 140\n");
    git("add", "-A");
    git("commit", "-m", "faster");

    const r = applyAlternative(dir);

    expect(r.wip).toBeUndefined();
    expect(readFileSync(song(), "utf8")).toBe("tempo: 140\n");
  });

  it("leaves the alternative in place, to read the direction again", () => {
    newAlternative(dir, "faster");
    writeFileSync(song(), "tempo: 140\n");
    applyAlternative(dir);
    expect(git("branch", "--list", "faster")).toContain("faster");
  });

  it("refuses on a branch that is not an alternative", () => {
    // No parent recorded — there is nowhere to apply it TO, and guessing would merge into whatever is handy.
    expect(() => applyAlternative(dir)).toThrow(/not an alternative/);
  });

  it("lands you back on the alternative when the merge conflicts", () => {
    newAlternative(dir, "faster");
    writeFileSync(song(), "tempo: 140\n");
    git("add", "-A");
    git("commit", "-m", "faster");
    // The parent moves the same line, so the merge cannot resolve itself.
    git("switch", "main");
    writeFileSync(song(), "tempo: 90\n");
    git("add", "-A");
    git("commit", "-m", "slower");
    git("switch", "faster");

    expect(() => applyAlternative(dir)).toThrow();
    // Not stranded on a half-merged parent with conflict markers in the file and no terminal to fix them.
    expect(on("faster")).toBe(true);
    expect(readFileSync(song(), "utf8")).toBe("tempo: 140\n");
  });
});

// The neighbours, pinned here because `apply`'s rule is "the same as switch's" — a change to one of them
// should be a visibly deliberate change to the pair.
describe("the other two verbs", () => {
  it("switch commits work in progress too", () => {
    newAlternative(dir, "faster");
    writeFileSync(song(), "tempo: 140\n");
    const r = switchAlternative(dir, "main");
    expect(r.wip).toMatch(/^wip /);
    expect(on("main")).toBe(true);
    // Committed on the branch it was made on, so coming back finds it where it was left.
    git("switch", "faster");
    expect(readFileSync(song(), "utf8")).toBe("tempo: 140\n");
  });

  it("cancel throws the work away, which is what it is for", () => {
    newAlternative(dir, "faster");
    writeFileSync(song(), "tempo: 140\n");
    cancelAlternative(dir);
    expect(on("main")).toBe(true);
    expect(readFileSync(song(), "utf8")).toBe("tempo: 120\n");
  });
});
