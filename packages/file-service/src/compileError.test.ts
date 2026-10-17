// A format refusal crosses the wire with its code and levels, on a document route's 400 and in
// /project-errors, so the browser can say "update k7". See packages/song-schema/docs/formatLevel.md.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectRoot } from "@studio/song/loader";
import type { ProjectDoc } from "@studio/song/project";
import {
  FORMAT_LEVEL,
  FormatTooNewError,
} from "@studio/song-schema/formatLevel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileErrorBody } from "./compileError.ts";
import { projectErrorsIn } from "./workspaceDocs.ts";

const NEXT = FORMAT_LEVEL + 1;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compile-error-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("compileErrorBody", () => {
  it("adds the code and both levels to a format refusal", () => {
    const body = compileErrorBody(new FormatTooNewError(NEXT));
    expect(body).toMatchObject({
      code: "format-too-new",
      fileLevel: NEXT,
      buildLevel: FORMAT_LEVEL,
    });
    expect(body.error).toMatch(/update k7/);
  });
  it("is the bare message for any other throw", () => {
    expect(compileErrorBody(new Error("boom"))).toEqual({ error: "boom" });
  });
});

describe("projectErrorsIn", () => {
  it("carries formatTooNew and puts the diagnostic on the format line", () => {
    writeFileSync(
      join(dir, "project.yaml"),
      `project:\n  tempo: 120\nformat: ${NEXT}\n`,
    );
    const r = projectErrorsIn(dir, () => {
      loadProjectRoot(dir, true);
      return {} as ProjectDoc;
    });
    expect(r.formatTooNew).toEqual({
      fileLevel: NEXT,
      buildLevel: FORMAT_LEVEL,
    });
    expect(r.errors).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ file: "project.yaml", line: 3 });
  });
});
