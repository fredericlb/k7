// What a `surfaces/` file must say, and what happens to one that says it wrong. The mapping is
// `views/mix.yaml`'s binding reused, so what is pinned here is the surface's own half — the
// type, the layout, and the fact that an unwired component is NOT a load error.
// See docs/surfaces.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSurface } from "@studio/song-schema/yaml/surfaceFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSurfaceFile, projectSurfaces, surfaceIssues } from "./surfaces";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-surf-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A project folder carrying `surfaces/<name>.yaml`. */
function withSurface(name: string, body: string): string {
  const dir = join(root, "song.st0");
  mkdirSync(join(dir, "surfaces"), { recursive: true });
  writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "song"\n');
  writeFileSync(join(dir, "surfaces", `${name}.yaml`), body);
  return dir;
}

const DESK = `type: turntables
layout: split
mapping:
  crossfade: { module: crossfade, param: Mix }
  deckA.tempo: { module: tempoA, param: Target BPM }
`;

describe("parseSurface", () => {
  it("reads the type, the layout and the mapping", () => {
    const { value, issues } = parseSurface(DESK);
    expect(issues).toEqual([]);
    expect(value?.type).toBe("turntables");
    expect(value?.layout).toBe("split");
    expect(value?.mapping?.crossfade).toEqual({
      module: "crossfade",
      param: "Mix",
    });
  });

  it("accepts a surface with NO mapping at all", () => {
    // The unwired state belongs on the screen: refusing the file refuses the whole project.
    const { value, issues } = parseSurface("type: turntables\nlayout: split\n");
    expect(issues).toEqual([]);
    expect(value?.mapping).toBeUndefined();
  });

  it("reads the PLAYLIST a desk draws its browser from", () => {
    const { value, issues } = parseSurface(
      ["type: turntables", "layout: split", "playlist: ete-2026", ""].join(
        "\n",
      ),
    );
    expect(issues).toEqual([]);
    // A NAME, not a path: the folder is fixed, so a path could only be wrong about it.
    expect(value?.playlist).toBe("ete-2026");
  });

  it("accepts a desk that names none", () => {
    // Same rule as `mapping` above: the browser says so, and the project still opens.
    const { value, issues } = parseSurface(
      ["type: turntables", "layout: split", ""].join("\n"),
    );
    expect(issues).toEqual([]);
    expect(value?.playlist).toBeUndefined();
  });

  it("refuses a playlist on a surface with no song browser", () => {
    // A field accepted and ignored is worse than one turned down: the same argument as `.strict()`.
    const { value, issues } = parseSurface(
      ["type: timeline", "layout: split", "playlist: ete-2026", ""].join("\n"),
    );
    expect(value).toBeNull();
    expect(issues.map((i) => i.message).join(" ")).toMatch(/turntables/);
  });

  it("refuses a type nothing can draw", () => {
    // A type names a COMPONENT that must exist, unlike a control id: otherwise, a blank screen.
    const { value, issues } = parseSurface("type: mixer\nlayout: view\n");
    expect(value).toBeNull();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("refuses a layout nothing can place", () => {
    expect(parseSurface("type: turntables\nlayout: panel\n").value).toBeNull();
  });

  it("reads the ARRANGEMENT, which is a surface like any other", () => {
    const { value, issues } = parseSurface("type: timeline\nlayout: split\n");
    expect(issues).toEqual([]);
    expect(value?.type).toBe("timeline");
    expect(value?.layout).toBe("split");
  });

  it("reads the FRAME, which is a surface like any other", () => {
    const { value, issues } = parseSurface("type: viewport\nlayout: split\n");
    expect(issues).toEqual([]);
    expect(value?.type).toBe("viewport");
    expect(value?.layout).toBe("split");
  });

  it("refuses a PAIR the editor has no component for", () => {
    // Both halves are valid alone, so the PAIR needs its own check — nothing draws in `view`.
    const inView = parseSurface("type: turntables\nlayout: view\n");
    expect(inView.value).toBeNull();
    expect(inView.issues[0].path).toBe("layout");
    expect(inView.issues[0].message).toContain("'split'");
    expect(parseSurface("type: timeline\nlayout: view\n").value).toBeNull();
    // A viewport owns a GL context per layer, which a screen you open and close would rebuild.
    expect(parseSurface("type: viewport\nlayout: view\n").value).toBeNull();
  });

  it("requires both halves", () => {
    expect(parseSurface("type: turntables\n").value).toBeNull();
    expect(parseSurface("layout: view\n").value).toBeNull();
  });

  it("names the unknown key rather than the file", () => {
    // `.strict()` reports the extra key on the OBJECT, so unwrapping `keys` is what names the line.
    const { issues } = parseSurface(
      "type: turntables\nlayout: split\nmappings: {}\n",
    );
    expect(issues.some((i) => i.path.includes("mappings"))).toBe(true);
  });

  it("says what an empty file is missing", () => {
    // An empty SURFACE does not say what it is, so there is nothing to draw.
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
    // The folder is OPTIONAL: reporting its absence would flag every song in the médiathèque.
    const dir = join(root, "plain.st0");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "plain"\n');
    expect(projectSurfaces(dir)).toEqual({ surfaces: [], diagnostics: [] });
  });

  it("reports a file that will not read, and keeps the others", () => {
    // One bad surface must not take the good ones down: the diagnostic names the file to fix.
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

describe("a project holding material and declaring no timeline", () => {
  const TIMELINE = "type: timeline\nlayout: split\n";

  /** Put a sequence in the folder -- the material a timeline would have drawn. */
  const arranged = (dir: string): string => {
    mkdirSync(join(dir, "sequences"), { recursive: true });
    writeFileSync(join(dir, "sequences", "melody.yaml"), "notes: []\n");
    return dir;
  };

  it("is warned about: it would open onto its graph with nothing to say why", () => {
    const dir = arranged(withSurface("desk", DESK));
    const warn = surfaceIssues(dir).filter((d) => d.severity === "warning");
    expect(warn.length).toBe(1);
    expect(warn[0].message).toContain("timeline");
    // A WARNING: the project is valid and opens, and the editor you would fix it in is inside it.
    expect(surfaceIssues(dir).some((d) => d.severity === "error")).toBe(false);
  });

  it("is silent once it declares one", () => {
    expect(surfaceIssues(arranged(withSurface("timeline", TIMELINE)))).toEqual(
      [],
    );
  });

  it("is silent for a project holding nothing arranged: a mix, or a bare rig", () => {
    // The FOLDER answers whether anything is arranged, and it cannot disagree with itself.
    expect(surfaceIssues(withSurface("desk", DESK))).toEqual([]);
  });

  it("warns a project with material and no surfaces/ folder at all", () => {
    // The missing folder and the missing ARRANGEMENT are two sentences; this project gets both.
    const dir = join(root, "plain.st0");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "plain"\n');
    expect(projectSurfaces(dir).diagnostics).toEqual([]);
    expect(surfaceIssues(arranged(dir)).map((d) => d.severity)).toEqual([
      "warning",
    ]);
  });
});

describe("a song with video lanes and no viewport", () => {
  const TIMELINE = "type: timeline\nlayout: split\n";

  /** `withSurface`'s folder, plus a video lane on disk. */
  function withPicture(name: string, body: string): string {
    const dir = withSurface(name, body);
    mkdirSync(join(dir, "video_tracks"), { recursive: true });
    writeFileSync(join(dir, "video_tracks", "main.yaml"), "kind: video\n");
    return dir;
  }

  it("is warned about — its lanes DRAW, so it looks like it is working", () => {
    const dir = withPicture("timeline", TIMELINE);
    const warn = surfaceIssues(dir).filter((d) => d.severity === "warning");
    expect(warn.length).toBe(1);
    expect(warn[0].message).toContain("viewport");
    expect(surfaceIssues(dir).some((d) => d.severity === "error")).toBe(false);
  });

  it("is silent once it declares one", () => {
    const dir = withPicture("timeline", TIMELINE);
    writeFileSync(
      join(dir, "surfaces", "viewport.yaml"),
      "type: viewport\nlayout: split\n",
    );
    expect(surfaceIssues(dir)).toEqual([]);
  });

  it("says nothing about picture to a song that has none", () => {
    // The check is on `video_tracks/`, or every song in the médiathèque grows a warning.
    expect(surfaceIssues(withSurface("timeline", TIMELINE))).toEqual([]);
  });

  it("can be missing BOTH, and says so twice", () => {
    const dir = withPicture("desk", DESK);
    expect(surfaceIssues(dir).map((d) => d.severity)).toEqual([
      "warning",
      "warning",
    ]);
  });
});

/** The writer behind `project surface new`: what it produces, the parser above accepts. */
describe("createSurfaceFile", () => {
  const project = (): string => {
    const dir = join(root, "song.st0");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "song"\n');
    return dir;
  };

  it("derives the layout, so the file it writes always parses", () => {
    // No layout argument: SURFACE_LAYOUTS_BY_TYPE says it, so asking could only produce a bad pair.
    const dir = project();
    for (const [type, layout] of [
      ["timeline", "split"],
      ["viewport", "split"],
      ["turntables", "split"],
    ] as const) {
      const rel = createSurfaceFile(dir, type);
      expect(rel).toBe(`surfaces/${type}.yaml`);
      const { value, issues } = parseSurface(
        readFileSync(join(dir, rel), "utf8"),
      );
      expect(issues, type).toEqual([]);
      // The mapping is tested below; this is about every type coming out with its own layout.
      expect({ type: value?.type, layout: value?.layout }).toEqual({
        type,
        layout,
      });
    }
    expect(
      projectSurfaces(dir)
        .surfaces.map((s) => s.id)
        .sort(),
    ).toEqual(["timeline", "turntables", "viewport"]);
  });

  it("takes an id, because that is what the header button says", () => {
    const dir = project();
    expect(createSurfaceFile(dir, "turntables", "desk")).toBe(
      "surfaces/desk.yaml",
    );
    expect(projectSurfaces(dir).surfaces[0].surface.type).toBe("turntables");
  });

  it("scaffolds a desk's mapping: every component, a null, and what it wants", () => {
    // `null` and not a comment: a key that is THERE is validated the moment it is filled in.
    const dir = project();
    createSurfaceFile(dir, "turntables", "desk");
    const text = readFileSync(join(dir, "surfaces/desk.yaml"), "utf8");
    expect(text).toContain("mapping:\n");
    expect(text).toContain("crossfade: null #");
    for (const d of ["A", "B"])
      for (const s of ["tempo", "eqLow", "eqMid", "eqHigh", "filter"])
        expect(text, `deck${d}.${s}`).toContain(`deck${d}.${s}: null #`);
    // …and it still parses, with the mapping read back as declared-but-unwired.
    const { value, issues } = parseSurface(text);
    expect(issues).toEqual([]);
    expect(value?.mapping?.crossfade).toBeNull();
  });

  it("scaffolds NO mapping for the two types that have no components", () => {
    // A mapping says which module a component MOVES, and these two types have no components.
    const dir = project();
    createSurfaceFile(dir, "timeline");
    expect(readFileSync(join(dir, "surfaces/timeline.yaml"), "utf8")).toBe(
      "type: timeline\nlayout: split\n",
    );
  });

  it("refuses a SECOND surface of the same type", () => {
    // The pane ring has one slot per type, so a second file changes nothing and shows nothing.
    const dir = project();
    createSurfaceFile(dir, "timeline");
    expect(() => createSurfaceFile(dir, "timeline", "second")).toThrow(
      /already declares a timeline/,
    );
  });

  it("refuses a second DESK too, now that it is a pane", () => {
    // A desk is a pane, so a second one would draw nowhere.
    const dir = project();
    createSurfaceFile(dir, "turntables", "desk");
    expect(() => createSurfaceFile(dir, "turntables", "warmup")).toThrow(
      /already declares a turntables/,
    );
  });

  it("refuses a name that is taken, and one a path could not carry", () => {
    const dir = project();
    createSurfaceFile(dir, "timeline");
    expect(() => createSurfaceFile(dir, "timeline")).toThrow(/already exists/);
    expect(() => createSurfaceFile(dir, "viewport", "../escape")).toThrow(
      /invalid surface name/,
    );
  });

  it("refuses a type nothing draws, naming the ones there are", () => {
    // Reached from a command line, where the word is a string until something checks it.
    expect(() => createSurfaceFile(project(), "mixer" as never)).toThrow(
      /unknown surface type 'mixer'/,
    );
  });

  it("clears the warning the project was showing", () => {
    // The whole point: the editor you would add the file in is inside the project it is missing from.
    const dir = project();
    // With something in it a timeline would have drawn -- which is what the warning is about.
    mkdirSync(join(dir, "sequences"), { recursive: true });
    writeFileSync(join(dir, "sequences", "melody.yaml"), "notes: []\n");
    expect(surfaceIssues(dir).map((d) => d.severity)).toEqual(["warning"]);
    createSurfaceFile(dir, "timeline");
    expect(surfaceIssues(dir)).toEqual([]);
  });
});
