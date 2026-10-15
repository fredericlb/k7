// livePath.test.ts — a path another replica named is written under the workspace, or not at all.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfirmedDir } from "./liveConfirmed.ts";
import { confinedPath } from "./livePath.ts";

describe("confinedPath", () => {
  const root = join(tmpdir(), "ws");

  it("answers a workspace path under the root", () => {
    expect(confinedPath(root, "song.k7/a.yaml")).toBe(
      join(root, "song.k7", "a.yaml"),
    );
  });

  it("throws for any path that would leave it", () => {
    for (const rel of ["../x", "a/../../x", "/etc/passwd", "a\\..\\..\\x", ""])
      expect(() => confinedPath(root, rel), rel).toThrow(/refused sync path/);
  });

  it("guards the confirmed mirror the same way", () => {
    const dir = new ConfirmedDir(mkdtempSync(join(tmpdir(), "confirmed-")));
    expect(() => dir.set("../escape.txt", "x")).toThrow(/refused sync path/);
    expect(() => dir.get("../../etc/passwd")).toThrow(/refused sync path/);
  });
});
