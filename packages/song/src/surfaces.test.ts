// What a `surfaces/` file must say, and what happens to one that says it wrong. The mapping is
// `views/mix.k7x`'s binding reused, so what is pinned here is the surface's own half — the
// type, the layout, and the fact that an unwired component is NOT a load error.
// See docs/surfaces.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSurface } from "@studio/song-schema/yaml/surfaceFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSurfaceFile, projectSurfaces, surfaceIssues } from "./surfaces";
import { writeDoc } from "./testSupport";
import { wsData, wsText } from "./yaml/workspaceDoc";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-surf-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A project folder holding only its `project.k7x`. */
function bare(name = "song"): string {
  const dir = join(root, `${name}.k7`);
  writeDoc(join(dir, "project.k7x"), { project: { name } });
  return dir;
}

/** A project folder carrying `surfaces/<name>.k7x`, its text as given. */
function withSurface(name: string, body: string): string {
  const dir = bare();
  mkdirSync(join(dir, "surfaces"), { recursive: true });
  writeFileSync(join(dir, "surfaces", `${name}.k7x`), body);
  return dir;
}

/** A surface file's k7x text: its type and layout, then whatever else it says. */
const surface = (type: string, layout?: string, rest = ""): string =>
  `type(${JSON.stringify(type)})\n${layout ? `layout(${JSON.stringify(layout)})\n` : ""}${rest}`;

const DESK = surface(
  "turntables",
  "split",
  `mapping({
  crossfade: { module: "crossfade", param: "Mix" },
  "deckA.tempo": { module: "tempoA", param: "Target BPM" },
})
`,
);
const TIMELINE = surface("timeline", "split");

/** Put a sequence in the folder — the material a timeline would have drawn. */
const arranged = (dir: string): string => {
  writeDoc(join(dir, "sequences", "melody.k7x"), { notes: [] });
  return dir;
};

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
    const { value, issues } = parseSurface(surface("turntables", "split"));
    expect(issues).toEqual([]);
    expect(value?.mapping).toBeUndefined();
    // Same rule for the playlist: the browser says so, and the project still opens.
    expect(value?.playlist).toBeUndefined();
  });

  it("reads the PLAYLIST a desk draws its browser from", () => {
    const { value, issues } = parseSurface(
      surface("turntables", "split", 'playlist("ete-2026")\n'),
    );
    expect(issues).toEqual([]);
    // A NAME, not a path: the folder is fixed, so a path could only be wrong about it.
    expect(value?.playlist).toBe("ete-2026");
  });

  it("refuses a playlist on a surface with no song browser", () => {
    // A field accepted and ignored is worse than one turned down: the same argument as `.strict()`.
    const { value, issues } = parseSurface(
      surface("timeline", "split", 'playlist("ete-2026")\n'),
    );
    expect(value).toBeNull();
    expect(issues.map((i) => i.message).join(" ")).toMatch(/turntables/);
  });

  it("refuses a type nothing can draw", () => {
    // A type names a COMPONENT that must exist, unlike a control id: otherwise, a blank screen.
    const { value, issues } = parseSurface(surface("mixer", "view"));
    expect(value).toBeNull();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("refuses a layout nothing can place", () => {
    expect(parseSurface(surface("turntables", "panel")).value).toBeNull();
  });

  it("reads the ARRANGEMENT, which is a surface like any other", () => {
    const { value, issues } = parseSurface(TIMELINE);
    expect(issues).toEqual([]);
    expect(value?.type).toBe("timeline");
    expect(value?.layout).toBe("split");
  });

  it("reads the FRAME, which is a surface like any other", () => {
    const { value, issues } = parseSurface(surface("viewport", "floating"));
    expect(issues).toEqual([]);
    expect(value?.type).toBe("viewport");
    expect(value?.layout).toBe("floating");
  });

  it("refuses a viewport declared as a page, naming the layout it draws in", () => {
    // A window over the layout, never a page of it: the pair check names the one-word fix.
    const asPage = parseSurface(surface("viewport", "split"));
    expect(asPage.value).toBeNull();
    expect(asPage.issues[0].message).toContain("'floating'");
  });

  it("refuses a PAIR the editor has no component for", () => {
    // Both halves are valid alone, so the PAIR needs its own check — nothing draws in `view`.
    const inView = parseSurface(surface("turntables", "view"));
    expect(inView.value).toBeNull();
    expect(inView.issues[0].path).toBe("layout");
    expect(inView.issues[0].message).toContain("'split'");
    expect(parseSurface(surface("timeline", "view")).value).toBeNull();
    // A viewport owns a GL context per layer, which a screen you open and close would rebuild.
    expect(parseSurface(surface("viewport", "view")).value).toBeNull();
  });

  it("requires both halves", () => {
    expect(parseSurface(surface("turntables")).value).toBeNull();
    expect(parseSurface('layout("view")\n').value).toBeNull();
  });

  it("names the unknown key rather than the file", () => {
    // `.strict()` reports the extra key on the OBJECT, so unwrapping `keys` is what names the line.
    const { issues } = parseSurface(
      surface("turntables", "split", "mappings({})\n"),
    );
    expect(issues.some((i) => i.path.includes("mappings"))).toBe(true);
  });

  it("says what an empty file is missing", () => {
    // An empty SURFACE does not say what it is, so there is nothing to draw.
    const { value, issues } = parseSurface("");
    expect(value).toBeNull();
    expect(issues[0].message).toContain("type");
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
    expect(projectSurfaces(bare("plain"))).toEqual({
      surfaces: [],
      diagnostics: [],
    });
  });

  it("reports a file that will not read, and keeps the others", () => {
    // One bad surface must not take the good ones down: the diagnostic names the file to fix.
    const dir = withSurface("desk", DESK);
    writeFileSync(join(dir, "surfaces", "broken.k7x"), "type([\n");
    const { surfaces, diagnostics } = projectSurfaces(dir);
    expect(surfaces.map((s) => s.id)).toEqual(["desk"]);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].file).toContain("broken");
  });

  it("never reads a surface under a YAML name", () => {
    const dir = withSurface("desk", DESK);
    writeFileSync(
      join(dir, "surfaces", "old.yaml"),
      "type: timeline\nlayout: split\n",
    );
    expect(projectSurfaces(dir).surfaces.map((s) => s.id)).toEqual(["desk"]);
  });

  it("gives a PROJECT-relative path, like every other Diagnostic", () => {
    // The editor matches these against its tree; an absolute path matches nothing.
    const dir = withSurface("desk", surface("turntables"));
    const [d] = projectSurfaces(dir).diagnostics;
    expect(d.file.startsWith("/")).toBe(false);
    expect(d.file).toBe("surfaces/desk.k7x");
  });
});

describe("a project holding material and declaring no timeline", () => {
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
    const dir = bare("plain");
    expect(projectSurfaces(dir).diagnostics).toEqual([]);
    expect(surfaceIssues(arranged(dir)).map((d) => d.severity)).toEqual([
      "warning",
    ]);
  });
});

describe("a song with video lanes and no viewport", () => {
  /** `withSurface`'s folder, plus a video lane on disk. */
  function withPicture(name: string, body: string): string {
    const dir = withSurface(name, body);
    writeDoc(join(dir, "video_tracks", "main.k7x"), { events: [] });
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
      join(dir, "surfaces", "viewport.k7x"),
      surface("viewport", "floating"),
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
  it("derives the layout, so the file it writes always parses", () => {
    // No layout argument: SURFACE_LAYOUTS_BY_TYPE says it, so asking could only produce a bad pair.
    const dir = bare();
    for (const [type, layout] of [
      ["timeline", "split"],
      ["viewport", "floating"],
      ["turntables", "split"],
    ] as const) {
      const rel = createSurfaceFile(dir, type);
      expect(rel).toBe(`surfaces/${type}.k7x`);
      const { value, issues } = parseSurface(wsText(join(dir, rel)));
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
    const dir = bare();
    expect(createSurfaceFile(dir, "turntables", "desk")).toBe(
      "surfaces/desk.k7x",
    );
    expect(projectSurfaces(dir).surfaces[0].surface.type).toBe("turntables");
  });

  it("scaffolds a desk's mapping: every component, a null, and what it wants", () => {
    // `null` and not a comment: a key that is THERE is validated the moment it is filled in.
    const dir = bare();
    createSurfaceFile(dir, "turntables", "desk");
    const text = wsText(join(dir, "surfaces/desk.k7x"));
    const mapping = wsData(join(dir, "surfaces/desk.k7x")).mapping as Record<
      string,
      unknown
    >;
    expect(mapping.crossfade).toBeNull();
    for (const d of ["A", "B"])
      for (const s of ["tempo", "eqLow", "eqMid", "eqHigh", "filter"])
        expect(mapping[`deck${d}.${s}`], `deck${d}.${s}`).toBeNull();
    // …each with a comment saying what it wants.
    expect(text).toMatch(/crossfade: null, \/\/ ./);
    // …and it still parses, with the mapping read back as declared-but-unwired.
    const { value, issues } = parseSurface(text);
    expect(issues).toEqual([]);
    expect(value?.mapping?.crossfade).toBeNull();
  });

  it("scaffolds NO mapping for the two types that have no components", () => {
    // A mapping says which module a component MOVES, and these two types have no components.
    const dir = bare();
    createSurfaceFile(dir, "timeline");
    expect(wsData(join(dir, "surfaces/timeline.k7x"))).toEqual({
      type: "timeline",
      layout: "split",
    });
  });

  it("refuses a SECOND surface of the same type", () => {
    // The pane ring has one slot per type, so a second file changes nothing and shows nothing.
    const dir = bare();
    createSurfaceFile(dir, "timeline");
    expect(() => createSurfaceFile(dir, "timeline", "second")).toThrow(
      /already declares a timeline/,
    );
  });

  it("refuses a second DESK too, now that it is a pane", () => {
    // A desk is a pane, so a second one would draw nowhere.
    const dir = bare();
    createSurfaceFile(dir, "turntables", "desk");
    expect(() => createSurfaceFile(dir, "turntables", "warmup")).toThrow(
      /already declares a turntables/,
    );
  });

  it("refuses a name that is taken, and one a path could not carry", () => {
    const dir = bare();
    createSurfaceFile(dir, "timeline");
    expect(() => createSurfaceFile(dir, "timeline")).toThrow(/already exists/);
    expect(() => createSurfaceFile(dir, "viewport", "../escape")).toThrow(
      /invalid surface name/,
    );
  });

  it("refuses a type nothing draws, naming the ones there are", () => {
    // Reached from a command line, where the word is a string until something checks it.
    expect(() => createSurfaceFile(bare(), "mixer" as never)).toThrow(
      /unknown surface type 'mixer'/,
    );
  });

  it("clears the warning the project was showing", () => {
    // The whole point: the editor you would add the file in is inside the project it is missing from.
    const dir = arranged(bare());
    expect(surfaceIssues(dir).map((d) => d.severity)).toEqual(["warning"]);
    createSurfaceFile(dir, "timeline");
    expect(surfaceIssues(dir)).toEqual([]);
  });
});
