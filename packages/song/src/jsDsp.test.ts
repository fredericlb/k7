import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModules } from "./loader";

// A module whose DSP is its own source says so with `plugin: {type: jsdsp}`, and the file is
// `jsdsp.ts` beside it. It used to be a `jsdsp:` field naming the file, next to a
// `plugin: {type: internal, name: DSP Graph}` that said nothing about it — two things that had
// to agree, and the one that mattered was the one nobody read.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-jsdsp-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const writeModule = (name: string, body: string, withSource = true) => {
  const folder = join(dir, "modules", "audio", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "module.yaml"), body, "utf8");
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
        "# Auto Wah [audioEffect] — a touch wah, swept by the signal's own envelope.",
        "# Its DSP is described in jsdsp.ts beside this file.",
        "plugin:",
        "  type: jsdsp",
        "  name: Auto Wah",
        "",
      ].join("\n"),
    );
    expect(loadModules(dir)["auto-wah"]?.jsdsp).toBe(join(folder, "jsdsp.ts"));
  });

  it("takes the inline spelling too", () => {
    writeModule("inline", "plugin: { type: jsdsp, name: Inline }\n");
    expect(loadModules(dir).inline?.jsdsp).toContain("jsdsp.ts");
  });

  it("gives an ordinary module none", () => {
    writeModule("plain", "plugin:\n  type: vst3\n  name: Serum\n", false);
    expect(loadModules(dir).plain?.jsdsp).toBeUndefined();
  });

  it("gives the OLD spelling none — the field is gone and `internal` is not the marker", () => {
    // A module left in the old form resolves no source at all, rather than half-working. It has
    // to be migrated, and this is what says so out loud instead of it going quiet at play time.
    writeModule(
      "legacy",
      "plugin:\n  type: internal\n  name: DSP Graph\njsdsp: legacy.ts\n",
    );
    expect(loadModules(dir).legacy?.jsdsp).toBeUndefined();
  });

  it("points at the file even before it exists", () => {
    // The type is a declaration, not a discovery: a module can claim its source before the file
    // is written, and the builder's tab is what creates it.
    const folder = writeModule("early", "plugin:\n  type: jsdsp\n", false);
    expect(loadModules(dir)["early"]?.jsdsp).toBe(join(folder, "jsdsp.ts"));
  });
});
