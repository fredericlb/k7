// What a failed clone SAYS on screen. git writes up to two hundred lines and the answer is at
// the end of them — the popin gets that, the console gets the rest.

import { describe, expect, it } from "vitest";
import { gitReason } from "./machine.ts";

describe("git's reason out of its output", () => {
  it("keeps the cause AND the fatal that followed from it", () => {
    const out = [
      "Cloning into '/state/workspace/hiver'...",
      "remote: Enumerating objects: 1200, done.",
      "git@host: Permission denied (publickey).",
      "fatal: Could not read from remote repository.",
    ].join("\n");
    expect(gitReason(out)).toBe(
      "git@host: Permission denied (publickey). — fatal: Could not read from remote repository. (the rest is in the console)",
    );
  });

  it("says nothing about a console when there was nothing else to put in it", () => {
    expect(gitReason("fatal: repository not found")).toBe(
      "fatal: repository not found",
    );
    expect(gitReason("ERROR: no such repo\nfatal: could not read")).toBe(
      "ERROR: no such repo — fatal: could not read",
    );
  });

  it("answers something for output that is empty or only blank lines", () => {
    expect(gitReason("")).toBe("clone failed");
    expect(gitReason("\n  \n\n")).toBe("clone failed");
  });
});
