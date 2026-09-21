// The workspace's `_modules` library is FIXED in STRUCTURE through this API — nothing renames, moves,
// deletes or adds a file THERE by hand. One library backs every project beside it, so a rename or a
// delete made while mixing one song would break the others, with no author and no way back;
// `module populate` rebuilds the folder and writes with plain `fs`, which is what leaves it the only writer.
//
// Its CONTENT is ordinary, though: a module lives at `@workspace` now, and is edited in place — there is
// no project-local copy left to fork a write into instead (see moduleFork.md). These tests cover the
// boundary: that structural routes stop, and that a plain content write goes straight through.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLibrary, writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let ws: Workspace;

const SHARED = "_modules/audio/delay/tape-delay/module.yaml";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-shared-"));
  writeLibrary(root);
  const proj = join(root, "song.st0");
  mkdirSync(join(proj, "modules"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), {
    project: { name: "song", modules_from: ["../_modules"] },
  });
  writeFileSync(
    join(proj, "graph.yaml"),
    'modules:\n  bs.lead: [ "@workspace/audio/delay/tape-delay" ]\n  "@workspace/audio/delay/tape-delay": [ OUT ]\n',
    "utf8",
  );
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the shared module library's structure is fixed", () => {
  it("refuses to rename, move, delete, or add to it", async () => {
    await expect(ws.renameEntry(SHARED, "other.yaml")).rejects.toThrow(
      /edited in place/,
    );
    await expect(ws.moveEntry(SHARED, "song.st0")).rejects.toThrow(
      /edited in place/,
    );
    await expect(ws.deleteEntry("_modules/audio")).rejects.toThrow(
      /edited in place/,
    );
    expect(() => ws.createFolder("_modules/audio", "mine")).toThrow(
      /edited in place/,
    );
    expect(() =>
      ws.uploadFile("_modules/audio", "ir.wav", Buffer.from("x")),
    ).toThrow(/edited in place/);
    // …and refuses to move something INTO it, which is a structural change to the library just the same.
    await expect(
      ws.moveEntry("song.st0/graph.yaml", "_modules"),
    ).rejects.toThrow(/edited in place/);
  });

  it("says which folder and what to do instead", async () => {
    await expect(ws.deleteEntry("_modules")).rejects.toThrow(/module populate/);
  });

  it("leaves a project folder that merely looks like it alone", () => {
    // The rule is a path SEGMENT, so a song called "my_modules" is an ordinary project.
    mkdirSync(join(root, "my_modules"), { recursive: true });
    expect(() => ws.createFolder("my_modules", "clips")).not.toThrow();
  });
});

describe("a module library OUTSIDE the workspace", () => {
  // The mediatek sits beside the workspaces, so `safePath` means these routes cannot ADDRESS it at all.
  it("cannot be reached by climbing out of the workspace", async () => {
    const outside = "../mediatek/modules/audio/reverb/module.yaml";
    expect(() => ws.write(outside, "plugin: {}\n")).toThrow(/escapes/);
    await expect(ws.deleteEntry("../mediatek")).rejects.toThrow(/escapes/);
    expect(() => ws.createFolder("../mediatek/modules", "mine")).toThrow(
      /escapes/,
    );
    expect(() =>
      ws.uploadFile("../mediatek/library/ir", "x.wav", Buffer.from("x")),
    ).toThrow(/escapes/);
  });

  it("cannot be reached through a symlink planted inside the workspace", () => {
    // The lexical check alone would pass here; `safePath`'s second gate realpaths and re-checks.
    const media = mkdtempSync(join(tmpdir(), "td-media-"));
    mkdirSync(join(media, "modules"), { recursive: true });
    try {
      symlinkSync(media, join(root, "link"), "junction");
    } catch {
      return; // no permission to create links on this machine — the lexical gate still stands
    }
    expect(() => ws.write("link/modules/x.yaml", "a: 1\n")).toThrow(/escapes/);
    rmSync(media, { recursive: true, force: true });
  });
});

describe("saving a shared module writes it in place", () => {
  const EDIT =
    "plugin:\n  name: Tape Delay\n  type: vst3\nparams:\n  Mix: 0.8\n";

  it("changes the library file itself, with no fork and nothing extra in the answer", () => {
    const { forked } = ws.write(SHARED, EDIT);
    expect(forked).toBeUndefined();
    expect(readFileSync(join(root, SHARED), "utf8")).toBe(EDIT);
  });

  it("writes a non-module file in there just as ordinarily", () => {
    writeFileSync(
      join(root, "_modules", "config.yaml"),
      "namespace: engine\n",
      "utf8",
    );
    ws.write("_modules/config.yaml", "namespace: other\n");
    expect(readFileSync(join(root, "_modules", "config.yaml"), "utf8")).toBe(
      "namespace: other\n",
    );
  });

  it("answers nothing extra for an ordinary save", () => {
    expect(ws.write("song.st0/notes.md", "hello")).toEqual({});
    expect(existsSync(join(root, "song.st0", "notes.md"))).toBe(true);
  });
});

describe("the catalogue the builder lists", () => {
  it("names the shared module and the file the builder opens", () => {
    const entry = ws
      .moduleCatalogue()
      .find((m) => m.ref === "@workspace/audio/delay/tape-delay");
    // Workspace-relative, so it goes straight back through read/write: a catalogue sits BESIDE the projects.
    expect(entry?.path).toBe(SHARED);
    expect(entry?.category).toBe("audio");
    expect(entry?.name).toBe("audio/delay/tape-delay");
  });

  it("offers no FILE for a project with no shared library, rather than throwing", () => {
    // A project with no `_modules` beside it lacks anything to OPEN, not anything to reach for.
    const solo = mkdtempSync(join(tmpdir(), "td-solo-"));
    mkdirSync(join(solo, "song.st0"), { recursive: true });
    writeYaml(join(solo, "song.st0", "project.yaml"), {
      project: { name: "song" },
    });
    const w = new Workspace(solo);
    w.setActiveProject("song.st0");
    const cat = w.moduleCatalogue();
    expect(cat.every((m) => m.path === undefined)).toBe(true);
    expect(cat.map((m) => m.ref)).toContain("@engine/OUT");
    rmSync(solo, { recursive: true, force: true });
  });
});
