// A project root's `format` survives every value edit byte for byte, YAML and k7x alike, since the
// writers change one value and nothing else. See ../../song-schema/docs/formatLevel.md.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectRoot } from "@studio/song/loader";
import { setFileValue, setQuotedKeyMap } from "@studio/song/yaml/edit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "format-kept-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (name: string) => readFileSync(join(dir, name), "utf8");

describe("the format key across a value edit", () => {
  it("stays in a YAML root when the tempo and the markers change", () => {
    writeFileSync(
      join(dir, "project.yaml"),
      "format: 1\nproject:\n  name: demo\n  tempo: 120\n",
    );
    setFileValue(join(dir, "project.yaml"), ["project", "tempo"], 96);
    setQuotedKeyMap(join(dir, "project.yaml"), ["markers"], { "2:1:1": "B" });
    const text = read("project.yaml");
    expect(
      text.startsWith("format: 1\nproject:\n  name: demo\n  tempo: 96\n"),
    ).toBe(true);
    expect(loadProjectRoot(dir, true).project?.tempo).toBe(96);
  });

  it("stays in a k7x root when the tempo changes", () => {
    writeFileSync(
      join(dir, "project.k7x"),
      'format(1)\nproject({ name: "demo", tempo: 120 })\n',
    );
    setFileValue(join(dir, "project.yaml"), ["project", "tempo"], 96);
    expect(read("project.k7x")).toBe(
      'format(1)\nproject({ name: "demo", tempo: 96 })\n',
    );
    expect(loadProjectRoot(dir, true).project?.tempo).toBe(96);
  });
});
