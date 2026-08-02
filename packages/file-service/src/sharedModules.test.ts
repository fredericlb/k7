// The workspace's `_modules` library is READ-ONLY through this API. One library backs every project beside it,
// so a rename or a delete made while mixing one song would break the others, with no author and no way back;
// `module populate` rebuilds the folder and writes with plain `fs`, which is what leaves it the only writer.
//
// Saving a module in it is the one thing that isn't refused: it forks into the project (see moduleFork.ts) —
// unless the caller is the module BUILDER, whose subject is the library itself and which writes it in place.
// These tests cover the boundary: that every other route stops, that the fork answer reaches the caller, and
// that the builder's opt-out is the only thing that gets through.

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
  const proj = join(root, "song");
  mkdirSync(join(proj, "modules"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), {
    project: { name: "song", modules_from: ["../_modules"] },
  });
  writeFileSync(
    join(proj, "chains.yaml"),
    'tracks:\n  bs.lead: [ "@engine/audio/delay/tape-delay" ]\nmodules:\n  "@engine/audio/delay/tape-delay": [ OUT ]\n',
    "utf8",
  );
  ws = new Workspace(root);
  ws.setActiveProject("song");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the shared module library is read-only", () => {
  it("refuses to rename, move, delete, or add to it", async () => {
    await expect(ws.renameEntry(SHARED, "other.yaml")).rejects.toThrow(
      /read-only/,
    );
    await expect(ws.moveEntry(SHARED, "song")).rejects.toThrow(/read-only/);
    await expect(ws.deleteEntry("_modules/audio")).rejects.toThrow(/read-only/);
    expect(() => ws.createFolder("_modules/audio", "mine")).toThrow(
      /read-only/,
    );
    expect(() =>
      ws.uploadFile("_modules/audio", "ir.wav", Buffer.from("x")),
    ).toThrow(/read-only/);
    // …and refuses to move something INTO it, which is a write to the library just the same.
    await expect(ws.moveEntry("song/chains.yaml", "_modules")).rejects.toThrow(
      /read-only/,
    );
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
  // The mediatek lives at ~/.lanes/mediatek, beside the workspaces rather than inside one.
  // It needs no read-only predicate of its own: every file route resolves through safePath,
  // which confines to the workspace root — so these routes cannot ADDRESS it at all. That
  // is a stronger guarantee than `_modules` gets, and this pins it rather than assuming it.
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
    // The lexical check alone would pass here; safePath's second gate realpaths and
    // re-checks, which is what makes the confinement hold.
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

describe("saving a shared module forks it into the project", () => {
  const EDIT =
    "plugin:\n  name: Tape Delay\n  type: vst3\nparams:\n  Mix: 0.8\n";

  it("writes the copy, not the library, and says where it went", () => {
    const before = readFileSync(join(root, SHARED), "utf8");
    const { forked } = ws.write(SHARED, EDIT);
    expect(readFileSync(join(root, SHARED), "utf8")).toBe(before);
    expect(forked?.module).toBe("bs_lead_tape-delay_1");
    expect(forked?.chains).toEqual(["bs.lead"]);
    // Workspace-relative, because that is the path space the editor and the file tree speak.
    expect(forked?.path).toBe(
      "song/modules/audio/bs_lead_tape-delay_1/module.yaml",
    );
    expect(readFileSync(join(root, forked!.path), "utf8")).toBe(EDIT);
  });

  it("still refuses a file in there that isn't a module", () => {
    writeFileSync(
      join(root, "_modules", "config.yaml"),
      "namespace: engine\n",
      "utf8",
    );
    expect(() =>
      ws.write("_modules/config.yaml", "namespace: other\n"),
    ).toThrow(/read-only/);
    expect(readFileSync(join(root, "_modules", "config.yaml"), "utf8")).toBe(
      "namespace: engine\n",
    );
  });

  it("answers nothing extra for an ordinary save", () => {
    expect(ws.write("song/notes.md", "hello")).toEqual({});
    expect(existsSync(join(root, "song", "notes.md"))).toBe(true);
  });
});

// There is NO exception any more. The builder used to pass a flag that wrote `_modules` in place; it lives in
// the médiathèque now, which is the only editable catalogue, so a workspace's copy is read-only for everyone
// without exception — and this test guards that the escape hatch stays closed.
describe("nothing edits the workspace library in place", () => {
  const EDIT =
    "plugin:\n  name: Tape Delay\n  type: vst3\nparams:\n  Mix: 0.9\n";

  it("forks even a save aimed straight at the shared file", () => {
    const before = readFileSync(join(root, SHARED), "utf8");
    expect(ws.write(SHARED, EDIT).forked).toBeDefined();
    expect(readFileSync(join(root, SHARED), "utf8")).toBe(before);
  });
});

describe("the catalogue the builder lists", () => {
  it("names the shared module and the file the builder opens", () => {
    const entry = ws
      .moduleCatalogue()
      .find((m) => m.ref === "@engine/audio/delay/tape-delay");
    // Workspace-relative, so it goes straight back through read/write — no project to anchor on, since a
    // catalogue sits BESIDE the projects.
    expect(entry?.path).toBe(SHARED);
    expect(entry?.category).toBe("audio");
    expect(entry?.name).toBe("audio/delay/tape-delay");
  });

  it("offers no FILE for a project with no shared library, rather than throwing", () => {
    // It used to answer nothing at all here, because the catalogue WAS the shared folder.
    // The engine's own modules have no files — that is the point — so what a project with
    // no `_modules` beside it lacks is anything to OPEN, not anything to reach for.
    const solo = mkdtempSync(join(tmpdir(), "td-solo-"));
    mkdirSync(join(solo, "song"), { recursive: true });
    writeYaml(join(solo, "song", "project.yaml"), {
      project: { name: "song" },
    });
    const w = new Workspace(solo);
    w.setActiveProject("song");
    const cat = w.moduleCatalogue();
    expect(cat.every((m) => m.path === undefined)).toBe(true);
    expect(cat.map((m) => m.ref)).toContain("@engine/OUT");
    rmSync(solo, { recursive: true, force: true });
  });
});
