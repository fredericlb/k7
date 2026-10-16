// A chain project's node completes to its uuid and is SHOWN as its module and its place; a project
// of named nodes gets no label, its name being already what a person reads. docs/completions.md.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { describe, expect, it } from "vitest";
import { completionItems, completions } from "./commandSpec";
import { testHost } from "./testHost";

const ID = "944c0b6e-1111-4222-8333-444455556666";
const project = () =>
  ({
    tracks: [{ id: "gtr", plugins: [{ id: `gtr:${ID}`, type: "internal" }] }],
  }) as unknown as ProjectDoc;

function chainProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "node-completion-"));
  mkdirSync(join(dir, "chains"));
  writeFileSync(
    join(dir, "chains", "gtr.yaml"),
    `start: true\nsteps:\n  - { id: l1, track: gtr }\n  - { id: ${ID}, extends: "@k7-core/audio/auto-wah" }\n  - to: [ { chain: MIX } ]\n`,
  );
  return dir;
}

describe("the nodes provider", () => {
  it("inserts the uuid and labels it with the module and the place", () => {
    const h = testHost({ songPath: chainProject(), project });
    expect(completionItems("node bypass ", h, "cli")).toEqual([
      {
        line: `node bypass ${ID}`,
        label: "@k7-core/audio/auto-wah · gtr · step 2",
      },
    ]);
    expect(completions("node bypass ", h, "cli")).toEqual([
      `node bypass ${ID}`,
    ]);
  });

  it("gives no label outside a chain project", () => {
    const dir = mkdtempSync(join(tmpdir(), "node-completion-"));
    const h = testHost({ songPath: dir, project });
    expect(completionItems("node bypass ", h, "cli")).toEqual([
      { line: `node bypass ${ID}` },
    ]);
  });
});
