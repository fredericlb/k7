// loadProjectRoot refuses a project root written at a newer format level, validating or not, and
// before a .k7x is parsed. See ../../song-schema/docs/formatLevel.md.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toYaml } from "@studio/k7x/yaml-bridge";
import {
  FORMAT_LEVEL,
  FormatTooNewError,
} from "@studio/song-schema/formatLevel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkProjectFormat, loadProjectRoot } from "./entities";

const NEXT = FORMAT_LEVEL + 1;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "format-level-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, text: string) =>
  writeFileSync(join(dir, name), text, "utf8");

describe("loadProjectRoot and the format level", () => {
  it.each([true, false])(
    "refuses a newer YAML root (validate %s)",
    (validate) => {
      write("project.yaml", `format: ${NEXT}\nproject:\n  tempo: 120\n`);
      expect(() => loadProjectRoot(dir, validate)).toThrow(FormatTooNewError);
    },
  );

  it.each([true, false])(
    "refuses a newer k7x root (validate %s)",
    (validate) => {
      write("project.k7x", `format(${NEXT})\nproject({ tempo: 120 })\n`);
      expect(() => loadProjectRoot(dir, validate)).toThrow(FormatTooNewError);
    },
  );

  it("refuses a newer k7x root whose later syntax this build cannot parse", () => {
    const text = `format(${NEXT})\nproject(tempo => 120)\n`;
    expect(() => toYaml(text)).toThrow();
    write("project.k7x", text);
    expect(() => loadProjectRoot(dir, true)).toThrow(/update k7 to open it/);
    expect(() => checkProjectFormat(dir)).toThrow(FormatTooNewError);
  });

  it("names the file and both levels", () => {
    write("project.yaml", `format: ${NEXT}\n`);
    try {
      loadProjectRoot(dir);
      expect.unreachable();
    } catch (e) {
      const err = e as FormatTooNewError;
      expect(err.code).toBe("format-too-new");
      expect(err.fileLevel).toBe(NEXT);
      expect(err.buildLevel).toBe(FORMAT_LEVEL);
      expect(err.file).toBe("project.yaml");
    }
  });

  it("loads the current level, written or absent", () => {
    write("project.yaml", `format: ${FORMAT_LEVEL}\nproject:\n  tempo: 99\n`);
    expect(loadProjectRoot(dir, true).project?.tempo).toBe(99);
    write("project.yaml", "project:\n  tempo: 98\n");
    expect(loadProjectRoot(dir, true).project?.tempo).toBe(98);
    expect(() => checkProjectFormat(dir)).not.toThrow();
  });

  it("loads a k7x root at the current level", () => {
    write("project.k7x", `format(${FORMAT_LEVEL})\nproject({ tempo: 97 })\n`);
    expect(loadProjectRoot(dir, true).project?.tempo).toBe(97);
  });
});
