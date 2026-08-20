// The workspace's set lists: what `_playlists/` answers, and what making one writes. The one
// thing worth pinning here is that the folder sits beside the ACTIVE PROJECT rather than inside
// it — `/tree` is rooted at the project on purpose, so a listing that followed the project would
// be empty from the day it shipped. See @studio/song/docs/playlists.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlaylist } from "@studio/song/playlist";
import { writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let ws: Workspace;

const write = (rel: string, body: string): void => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-playlists-"));
  const proj = join(root, "song.st0");
  mkdirSync(proj, { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Workspace.playlists", () => {
  it("is empty, not a throw, before anything has made the folder", () => {
    // An account with no set list has none. That is a fact about the workspace and not a
    // failure to report, so the screen draws its empty state rather than an error.
    expect(ws.playlists()).toEqual([]);
  });

  it("reads the title and the count out of each file, at any depth", () => {
    write(
      "_playlists/ete-2026.yaml",
      "title: Été 2026\nitems:\n  - AC-DC/Back in Black/Hells Bells\n",
    );
    write("_playlists/live/repet.yaml", "items:\n  - a\n  - b\n");
    expect(ws.playlists()).toEqual([
      {
        path: "_playlists/ete-2026.yaml",
        name: "ete-2026",
        title: "Été 2026",
        count: 1,
        ok: true,
      },
      // No title: the file's stem stands in, which is what the row shows.
      {
        path: "_playlists/live/repet.yaml",
        name: "repet",
        count: 2,
        ok: true,
      },
    ]);
  });

  it("lists a file that does NOT parse, so you can click it and fix it", () => {
    write("_playlists/cassee.yaml", "items: [\n");
    const [p] = ws.playlists();
    // It is on the disk. A listing that hid it would leave you unable to open the one thing
    // you have to go and repair — the same rule the médiathèque's scan followed before this.
    expect(p).toMatchObject({ name: "cassee", count: 0, ok: false });
  });

  it("looks beside the active project, not inside it", () => {
    // The regression this guards: rooting the walk at the active project would give a
    // workspace of four songs four separate playlist folders, and a set list belongs to the
    // repository. A file under the PROJECT's own `_playlists` is therefore not one of these.
    write("_playlists/mine.yaml", "items: []\n");
    write("song.st0/_playlists/not-mine.yaml", "items: []\n");
    expect(ws.playlists().map((p) => p.path)).toEqual(["_playlists/mine.yaml"]);
  });

  it("ignores what is not a .yaml", () => {
    write("_playlists/notes.txt", "pas une playlist\n");
    write("_playlists/ok.yml", "items: []\n"); // the other spelling counts
    expect(ws.playlists().map((p) => p.name)).toEqual(["ok"]);
  });
});

describe("Workspace.createPlaylist", () => {
  it("writes a stub that PARSES, and adds the extension", () => {
    const { path } = ws.createPlaylist("été 2026");
    expect(path).toBe("_playlists/été 2026.yaml");
    const text = readFileSync(join(root, path), "utf8");
    // Not an empty file: the screen draws its right-hand pane from the text, so a blank one
    // would open on a parse failure for a playlist nobody has yet had a chance to get wrong.
    expect(parsePlaylist(text)).toEqual({ title: "été 2026", items: [] });
  });

  it("keeps an extension already typed rather than doubling it", () => {
    expect(ws.createPlaylist("set.yaml").path).toBe("_playlists/set.yaml");
  });

  it("refuses one that is already there rather than opening it", () => {
    ws.createPlaylist("set");
    // A "create" that quietly handed back somebody else's set list is how you edit the wrong
    // one — and the file on disk must be untouched by the refusal.
    expect(() => ws.createPlaylist("set")).toThrow(/already there/);
    expect(
      parsePlaylist(readFileSync(join(root, "_playlists/set.yaml"), "utf8")),
    ).toEqual({
      title: "set",
      items: [],
    });
  });

  it("cannot be talked out of the folder", () => {
    expect(() => ws.createPlaylist("../../escaped")).toThrow();
    expect(existsSync(join(root, "..", "escaped.yaml"))).toBe(false);
  });

  it("refuses a name that is only whitespace", () => {
    expect(() => ws.createPlaylist("   ")).toThrow(/needs a name/);
  });
});
