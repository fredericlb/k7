import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModuleRefs } from "./loader";
import { writeDoc } from "./testSupport";

// `plugin: {type: jsdsp}` with `jsdsp.ts` beside it — one declaration, not two fields that must agree.
// A jsdsp source needs its OWN folder, which is why these modules live at `@workspace`.

let ws: string;
let dir: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-jsdsp-"));
  dir = join(ws, "song");
  writeDoc(join(dir, "project.k7x"), {
    project: { name: "song", tempo: 120 },
  });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

const writeModule = (name: string, body: string, withSource = true) => {
  const folder = join(ws, "_modules", "audio", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "module.k7x"), body, "utf8");
  if (withSource)
    writeFileSync(join(folder, "jsdsp.ts"), "export default {};\n", "utf8");
  return folder;
};

describe("a module whose DSP is its own source", () => {
  it("resolves jsdsp.ts from the TYPE, with no field naming it", () => {
    // The real shape, comments and all: this is what the médiathèque's auto-wah looks like.
    const folder = writeModule(
      "auto-wah",
      [
        "// Auto Wah [audioEffect] — a touch wah, swept by the signal's own envelope.",
        "// Its DSP is described in jsdsp.ts beside this file.",
        'plugin({ type: "jsdsp", name: "Auto Wah" })',
        "",
      ].join("\n"),
    );
    expect(loadModuleRefs(dir, {})["@workspace/audio/auto-wah"]?.jsdsp).toBe(
      join(folder, "jsdsp.ts"),
    );
  });

  it("gives an ordinary module none", () => {
    writeModule("plain", 'plugin({ type: "vst3", name: "Serum" })\n', false);
    expect(
      loadModuleRefs(dir, {})["@workspace/audio/plain"]?.jsdsp,
    ).toBeUndefined();
  });

  it("gives the OLD spelling none — the field is gone and `internal` is not the marker", () => {
    // The old form resolves NO source rather than half-working, so it is loud instead of quiet.
    writeModule(
      "legacy",
      'plugin({ type: "internal", name: "DSP Graph" })\njsdsp("legacy.ts")\n',
    );
    expect(
      loadModuleRefs(dir, {})["@workspace/audio/legacy"]?.jsdsp,
    ).toBeUndefined();
  });

  it("points at the file even before it exists", () => {
    // A declaration, not a discovery: a module claims its source before the file is written.
    const folder = writeModule("early", 'plugin({ type: "jsdsp" })\n', false);
    expect(loadModuleRefs(dir, {})["@workspace/audio/early"]?.jsdsp).toBe(
      join(folder, "jsdsp.ts"),
    );
  });
});
