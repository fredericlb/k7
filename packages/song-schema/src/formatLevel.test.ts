// The project format level: read off the raw text, refused above this build, and the editor's check
// answering the refusal as the one issue of a project root. See ../docs/formatLevel.md.

import { describe, expect, it } from "vitest";
import {
  checkFormatLevel,
  FORMAT_LEVEL,
  FormatTooNewError,
  formatLevelOf,
  formatLevelOfText,
  formatLineOf,
  isFormatTooNew,
} from "./formatLevel";
import { validateFile } from "./yaml/validate";

const NEXT = FORMAT_LEVEL + 1;

describe("formatLevelOfText", () => {
  it("reads a root `format(N)`", () => {
    expect(formatLevelOfText('project({ name: "a" })\nformat(4)\n')).toBe(4);
  });
  it("answers null when the text declares none, and ignores a nested key", () => {
    expect(formatLevelOfText("project({ tempo: 120 })\n")).toBeNull();
    expect(formatLevelOfText("project({\n  format: 9\n})\n")).toBeNull();
  });
  it("finds the line it is declared on", () => {
    expect(formatLineOf("project({\n  tempo: 1\n})\nformat(2)\n")).toBe(4);
  });
});

describe("formatLevelOf", () => {
  it("is the parsed root's `format`, absent meaning 1", () => {
    expect(formatLevelOf({ format: 2 })).toBe(2);
    expect(formatLevelOf({ project: {} })).toBe(1);
    expect(formatLevelOf(null)).toBe(1);
  });
});

describe("FormatTooNewError", () => {
  it("carries its code, both levels and the update message", () => {
    const e = new FormatTooNewError(NEXT, FORMAT_LEVEL, "project.k7x");
    expect(e.code).toBe("format-too-new");
    expect(e.fileLevel).toBe(NEXT);
    expect(e.buildLevel).toBe(FORMAT_LEVEL);
    expect(e.message).toMatch(
      /^project\.k7x: this project was written by a newer k7/,
    );
    expect(e.message).toMatch(/update k7 to open it/);
  });
  it("is thrown above this build's level only", () => {
    expect(() => checkFormatLevel(FORMAT_LEVEL)).not.toThrow();
    expect(() => checkFormatLevel(null)).not.toThrow();
    expect(() => checkFormatLevel(NEXT)).toThrow(FormatTooNewError);
  });
  it("is recognised by its code after a wire hop", () => {
    expect(isFormatTooNew(new FormatTooNewError(NEXT))).toBe(true);
    expect(isFormatTooNew({ code: "format-too-new", fileLevel: NEXT })).toBe(
      true,
    );
    expect(isFormatTooNew(new Error("format-too-new"))).toBe(false);
  });
});

describe("validateFile on a project root", () => {
  it("refuses a newer project with the update message, on the format line", () => {
    const v = validateFile(
      "song.k7/project.k7x",
      `project({\n  tempo: 120\n})\nformat(${NEXT})\n`,
    );
    expect(v.ok).toBe(false);
    expect(v.issues).toHaveLength(1);
    expect(v.issues[0].message).toMatch(/update k7 to open it/);
    expect(v.issues[0].line).toBe(4);
  });
  it("refuses a newer project even when the rest does not parse", () => {
    const v = validateFile(
      "song.k7/project.k7x",
      `format(${NEXT})\nproject(@@ new syntax)\n`,
    );
    expect(v.ok).toBe(false);
    expect(v.malformed).toBe(false);
    expect(v.issues[0].message).toMatch(/newer k7/);
  });
  it("accepts the current level, written or absent", () => {
    expect(
      validateFile(
        "p.k7/project.k7x",
        `format(${FORMAT_LEVEL})\nproject({ tempo: 120 })\n`,
      ).ok,
    ).toBe(true);
    expect(
      validateFile("p.k7/project.k7x", "project({ tempo: 120 })\n").ok,
    ).toBe(true);
  });
  it("leaves a `format` key in any other file to that file's own schema", () => {
    const v = validateFile("p.k7/clips/a.k7x", `format(${NEXT})\n`);
    expect(v.issues.every((i) => !/newer k7/.test(i.message))).toBe(true);
  });
});
