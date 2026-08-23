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
    // The unwired state is a real one and belongs on the SCREEN, component by component —
    // "ce composant n'est pas mappé" is something you read next to the knob that does nothing.
    // Refusing the file would refuse to open the project because one knob is unwired.
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
    // A NAME, not a path: the folder is fixed, so spelling it into the declaration would let a
    // file be wrong about a location nothing can choose. See @studio/song/playlist.
    expect(value?.playlist).toBe("ete-2026");
  });

  it("accepts a desk that names none", () => {
    // Same rule as `mapping` above: the browser says "this desk names no playlist", which is a
    // sentence you can act on. Refusing the file would refuse to open the project.
    const { value, issues } = parseSurface(
      ["type: turntables", "layout: split", ""].join("\n"),
    );
    expect(issues).toEqual([]);
    expect(value?.playlist).toBeUndefined();
  });

  it("refuses a playlist on a surface with no song browser", () => {
    // A field that is accepted and does nothing is worse than one turned down: whoever wrote it
    // goes looking for the effect somewhere else. Same argument as `.strict()`'s.
    const { value, issues } = parseSurface(
      ["type: timeline", "layout: split", "playlist: ete-2026", ""].join("\n"),
    );
    expect(value).toBeNull();
    expect(issues.map((i) => i.message).join(" ")).toMatch(/turntables/);
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
    // Both halves are valid on their own, which is exactly why the pair needs its own check: a
    // surface asking for a layout nothing places it in names something nothing draws — the
    // blank screen the `type` enum exists to prevent.
    //
    // NOTHING draws in `view` any more: the desk was the last one and became a pane. The word is
    // still in the enum precisely so this check can answer a file that says it, by name.
    const inView = parseSurface("type: turntables\nlayout: view\n");
    expect(inView.value).toBeNull();
    expect(inView.issues[0].path).toBe("layout");
    expect(inView.issues[0].message).toContain("'split'");
    expect(parseSurface("type: timeline\nlayout: view\n").value).toBeNull();
    // A viewport owns a GL context and a <video> per layer; a screen you open and close would
    // rebuild both every time. `full` is how the picture gets big.
    expect(parseSurface("type: viewport\nlayout: view\n").value).toBeNull();
  });

  it("requires both halves", () => {
    expect(parseSurface("type: turntables\n").value).toBeNull();
    expect(parseSurface("layout: view\n").value).toBeNull();
  });

  it("names the unknown key rather than the file", () => {
    // `.strict()` reports an extra key on the OBJECT, so without unwrapping `keys` the message
    // lands on the whole file and the reader has to hunt for the line they typed.
    const { issues } = parseSurface(
      "type: turntables\nlayout: split\nmappings: {}\n",
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
    const dir = join(root, "plain.st0");
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
    // What `project_type: live` used to answer, answered by the FOLDER instead: no clips, no
    // sequences, so there is nothing a timeline would have shown and nothing to warn about.
    // Strictly better than the declaration was, because a folder cannot disagree with itself.
    expect(surfaceIssues(withSurface("desk", DESK))).toEqual([]);
  });

  it("warns a project with material and no surfaces/ folder at all", () => {
    // `projectSurfaces` stays silent about the missing folder, which is the ordinary case. The
    // missing ARRANGEMENT is a different sentence, and this is the one project that gets both.
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
    // The check is on `video_tracks/`, not on the declaration: a song with no picture must not
    // be told to add a viewport, or every song in the médiathèque grows a warning.
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

/**
 * `project surface new` — the writer behind it. What matters is that the file it produces is one
 * the parser above accepts BY CONSTRUCTION, and that it refuses the two states that would leave
 * somebody editing a file nothing draws.
 */
describe("createSurfaceFile", () => {
  const project = (): string => {
    const dir = join(root, "song.st0");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "song"\n');
    return dir;
  };

  it("derives the layout, so the file it writes always parses", () => {
    // No layout argument anywhere: SURFACE_LAYOUTS_BY_TYPE already says which one each type is
    // drawn in, so asking could only produce a pair the schema refuses a moment later.
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
      // The mapping is the skeleton's business, tested below; what this one is about is that
      // every type comes out with the layout it is drawn in and a file the parser accepts.
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
    // `null` and not a comment: a key that is THERE is validated the moment it is filled in,
    // where a commented line is not something a parser can ever tell you that you got wrong.
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
    // A mapping says which module a component MOVES. The arrangement draws the project's own
    // lanes and the frame composites its own layers — neither has one, so an empty `mapping:`
    // would be a line inviting something that does not exist.
    const dir = project();
    createSurfaceFile(dir, "timeline");
    expect(readFileSync(join(dir, "surfaces/timeline.yaml"), "utf8")).toBe(
      "type: timeline\nlayout: split\n",
    );
  });

  it("refuses a SECOND surface of the same type", () => {
    // Only one is drawn — App.tsx takes the first of each and the pane ring has one slot — so a
    // second is a file that changes nothing and shows nothing.
    const dir = project();
    createSurfaceFile(dir, "timeline");
    expect(() => createSurfaceFile(dir, "timeline", "second")).toThrow(
      /already declares a timeline/,
    );
  });

  it("refuses a second DESK too, now that it is a pane", () => {
    // It used to be allowed: a `turntables` was a `view`, each got its own header button, and
    // several were a real arrangement — a warm-up desk beside the main one. The desk is a pane
    // now, with one slot in the ring like every other type, so the second would draw nowhere.
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
    // The whole point: `surfaceIssues` tells an arrangement with no timeline to add the file, and
    // the editor you would add it in is inside that project. Now a command does it.
    const dir = project();
    // With something in it a timeline would have drawn -- which is what the warning is about.
    mkdirSync(join(dir, "sequences"), { recursive: true });
    writeFileSync(join(dir, "sequences", "melody.yaml"), "notes: []\n");
    expect(surfaceIssues(dir).map((d) => d.severity)).toEqual(["warning"]);
    createSurfaceFile(dir, "timeline");
    expect(surfaceIssues(dir)).toEqual([]);
  });
});
