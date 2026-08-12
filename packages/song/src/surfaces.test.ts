// What a `surfaces/` file must say, and what happens to one that says it wrong. The mapping is
// `views/mix.yaml`'s binding reused, so what is pinned here is the surface's own half — the
// type, the layout, and the fact that an unwired component is NOT a load error.
// See docs/surfaces.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectSurfaces } from "./surfaces";
import { parseSurface } from "./yaml/surfaceFile";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-surf-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A project folder carrying `surfaces/<name>.yaml`. */
function withSurface(name: string, body: string): string {
  const dir = join(root, "song.l8");
  mkdirSync(join(dir, "surfaces"), { recursive: true });
  writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "song"\n');
  writeFileSync(join(dir, "surfaces", `${name}.yaml`), body);
  return dir;
}

const DESK = `type: turntables
layout: view
mapping:
  crossfade: { module: crossfade, param: Mix }
  deckA.tempo: { module: tempoA, param: Target BPM }
`;

describe("parseSurface", () => {
  it("reads the type, the layout and the mapping", () => {
    const { value, issues } = parseSurface(DESK);
    expect(issues).toEqual([]);
    expect(value?.type).toBe("turntables");
    expect(value?.layout).toBe("view");
    expect(value?.mapping?.crossfade).toEqual({
      module: "crossfade",
      param: "Mix",
    });
  });

  it("accepts a surface with NO mapping at all", () => {
    // The unwired state is a real one and belongs on the SCREEN, component by component —
    // "ce composant n'est pas mappé" is something you read next to the knob that does nothing.
    // Refusing the file would refuse to open the project because one knob is unwired.
    const { value, issues } = parseSurface("type: turntables\nlayout: view\n");
    expect(issues).toEqual([]);
    expect(value?.mapping).toBeUndefined();
  });

  it("refuses a type nothing can draw", () => {
    // Unlike a control id — app vocabulary, deliberately unvalidated — a type names a COMPONENT
    // that must exist. A folder asking for one nothing draws opens onto a blank screen.
    const { value, issues } = parseSurface("type: mixer\nlayout: view\n");
    expect(value).toBeNull();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("refuses a layout nothing can place", () => {
    expect(parseSurface("type: turntables\nlayout: panel\n").value).toBeNull();
  });

  it("requires both halves", () => {
    expect(parseSurface("type: turntables\n").value).toBeNull();
    expect(parseSurface("layout: view\n").value).toBeNull();
  });

  it("names the unknown key rather than the file", () => {
    // `.strict()` reports an extra key on the OBJECT, so without unwrapping `keys` the message
    // lands on the whole file and the reader has to hunt for the line they typed.
    const { issues } = parseSurface(
      "type: turntables\nlayout: view\nmappings: {}\n",
    );
    expect(issues.some((i) => i.path.includes("mappings"))).toBe(true);
  });

  it("says what an empty file is missing", () => {
    // Where this parts company with views/mix.yaml, whose empty file is a desk with nothing
    // bound yet. An empty SURFACE does not say what it is, and there is nothing to draw.
    const { value, issues } = parseSurface("");
    expect(value).toBeNull();
    expect(issues[0].message).toContain("type");
  });

  it("refuses a list", () => {
    expect(parseSurface("- type: turntables\n").value).toBeNull();
  });
});

describe("projectSurfaces", () => {
  it("finds them by filename, and the id IS the filename", () => {
    const dir = withSurface("desk", DESK);
    const { surfaces, diagnostics } = projectSurfaces(dir);
    expect(diagnostics).toEqual([]);
    expect(surfaces.map((s) => s.id)).toEqual(["desk"]);
    expect(surfaces[0].surface.type).toBe("turntables");
  });

  it("is silent about a project with no surfaces/ folder", () => {
    // The folder is OPTIONAL and almost no project has one. Reporting its absence would put a
    // diagnostic on every song in the médiathèque.
    const dir = join(root, "plain.l8");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "plain"\n');
    expect(projectSurfaces(dir)).toEqual({ surfaces: [], diagnostics: [] });
  });

  it("reports a file that will not read, and keeps the others", () => {
    // One bad surface must not take the good ones down with it: the editor still draws what it
    // can, and the diagnostic names the file to fix.
    const dir = withSurface("desk", DESK);
    writeFileSync(join(dir, "surfaces", "broken.yaml"), "type: [\n");
    const { surfaces, diagnostics } = projectSurfaces(dir);
    expect(surfaces.map((s) => s.id)).toEqual(["desk"]);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].file).toContain("broken");
  });

  it("gives a PROJECT-relative path, like every other Diagnostic", () => {
    // The editor matches these against its tree; an absolute path matches nothing.
    const dir = withSurface("desk", "type: turntables\n");
    const [d] = projectSurfaces(dir).diagnostics;
    expect(d.file.startsWith("/")).toBe(false);
    expect(d.file).toBe("surfaces/desk.yaml");
  });
});
