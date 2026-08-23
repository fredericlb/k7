// A shader module's GLSL: which shaders it offers, which one a name reads back, and the two
// refusals — a folder missing a stage is not a shader, and a ref that climbs out is not read.
// See docs/shaders.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moduleShaderChoices, readShader } from "./shaders";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shaders-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A module folder carrying `shaders/<name>/…`. `stages` says which of the two files to write. */
function shaderModule(
  folder: string,
  shaders: Record<string, "both" | "fragment-only">,
): string {
  const abs = join(root, folder);
  for (const [name, stages] of Object.entries(shaders)) {
    const dir = join(abs, "shaders", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fragment.glsl"), `// ${folder}/${name} frag\n`);
    if (stages === "both")
      writeFileSync(join(dir, "vertex.glsl"), `// ${folder}/${name} vert\n`);
  }
  mkdirSync(abs, { recursive: true });
  return abs;
}

describe("moduleShaderChoices", () => {
  it("lists the module's own shaders, sorted", () => {
    const folderAbs = shaderModule("glow", { ripple: "both", pulse: "both" });
    expect(moduleShaderChoices(root, { folderAbs }, {})).toEqual([
      "pulse",
      "ripple",
    ]);
  });

  it("skips a folder missing a stage — half a shader is not one", () => {
    // Offering it would fail inside the compositor, with a message about GL rather than a file.
    const folderAbs = shaderModule("glow", {
      pulse: "both",
      half: "fragment-only",
    });
    expect(moduleShaderChoices(root, { folderAbs }, {})).toEqual(["pulse"]);
  });

  it("walks the ANCESTRY — a thin local module offers the shared one's shaders", () => {
    // The normal shape: a song points at a shared module through a thin local one.
    const shared = shaderModule("lib", { ripple: "both" });
    const local = shaderModule("local", {});
    expect(
      moduleShaderChoices(
        root,
        { folderAbs: local, extends: "@st0/shaders/glow" },
        { "@st0/shaders/glow": { folderAbs: shared } },
      ),
    ).toEqual(["ripple"]);
  });

  it("shadows an inherited shader with a local one of the same name", () => {
    const shared = shaderModule("lib", { pulse: "both", ripple: "both" });
    const local = shaderModule("local", { pulse: "both" });
    const refs = { "@st0/shaders/glow": { folderAbs: shared } };
    const module = { folderAbs: local, extends: "@st0/shaders/glow" };
    expect(moduleShaderChoices(root, module, refs)).toEqual([
      "pulse",
      "ripple",
    ]);
    // …and the source that comes back is the nearer one, so the list and the pick agree.
    expect(readShader(root, module, refs, "pulse")?.fragment).toContain(
      "local/pulse",
    );
  });

  it("is empty for a module with no shaders/ folder at all", () => {
    expect(
      moduleShaderChoices(root, { folderAbs: join(root, "nope") }, {}),
    ).toEqual([]);
  });
});

describe("readShader", () => {
  it("reads both stages", () => {
    const folderAbs = shaderModule("glow", { pulse: "both" });
    const s = readShader(root, { folderAbs }, {}, "pulse");
    expect(s?.name).toBe("pulse");
    expect(s?.vertex).toContain("glow/pulse vert");
    expect(s?.fragment).toContain("glow/pulse frag");
  });

  it("returns null for a name the module does not carry", () => {
    // Null and not a throw: an unsynced shader folder loses the effect, not the project.
    const folderAbs = shaderModule("glow", { pulse: "both" });
    expect(readShader(root, { folderAbs }, {}, "ripple")).toBeNull();
  });

  it("refuses a ref that climbs out of the module", () => {
    // Checked before any path is built, `../` being how a module's containment is escaped.
    const folderAbs = shaderModule("glow", { pulse: "both" });
    expect(
      readShader(root, { folderAbs }, {}, "../glow/shaders/pulse"),
    ).toBeNull();
    expect(readShader(root, { folderAbs }, {}, "a/b")).toBeNull();
  });
});
