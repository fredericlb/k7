// A project root's `format` survives every value edit byte for byte, since the writers change one
// value and nothing else. See ../../song-schema/docs/formatLevel.md.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectRoot } from "@studio/song/loader";
import { setFileValue } from "@studio/song/yaml/edit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "format-kept-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const root = () => join(dir, "project.k7x");

describe("the format key across a value edit", () => {
  it("stays when the tempo changes", () => {
    writeFileSync(root(), 'format(1)\nproject({ name: "demo", tempo: 120 })\n');
    setFileValue(root(), ["project", "tempo"], 96);
    expect(readFileSync(root(), "utf8")).toBe(
      'format(1)\nproject({ name: "demo", tempo: 96 })\n',
    );
    expect(loadProjectRoot(dir, true).project?.tempo).toBe(96);
  });

  it("stays when markers are added beside it", () => {
    writeFileSync(root(), 'format(1)\nproject({ name: "demo", tempo: 120 })\n');
    setFileValue(root(), ["markers"], { "2:1:1": "B" });
    const text = readFileSync(root(), "utf8");
    expect(
      text.startsWith('format(1)\nproject({ name: "demo", tempo: 120 })\n'),
    ).toBe(true);
    expect(loadProjectRoot(dir, true).markers).toEqual({ "2:1:1": "B" });
  });
});
