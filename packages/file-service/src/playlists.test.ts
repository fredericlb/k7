// The workspace's set lists: what `_playlists/` answers. The one thing worth pinning here is
// that the folder sits beside the ACTIVE PROJECT rather than inside it — `/tree` is rooted at the
// project on purpose, so a listing that followed the project would be empty from the day it
// shipped. See @studio/song/docs/playlists.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
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
  const proj = join(root, "song.k7");
  mkdirSync(proj, { recursive: true });
  writeDoc(join(proj, "project.k7x"), { project: { name: "song" } });
  ws = new Workspace(root);
  ws.setActiveProject("song.k7");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Workspace.playlists", () => {
  it("is empty, not a throw, before anything has made the folder", () => {
    // An account with no set list has none: a fact about the workspace, not a failure to report.
    expect(ws.playlists()).toEqual([]);
  });

  it("reads the title and the count out of each file, at any depth", () => {
    write(
      "_playlists/ete-2026.k7x",
      'title("Été 2026")\nitems(["AC-DC/Back in Black/Hells Bells"])\n',
    );
    write("_playlists/live/repet.k7x", 'items(["a", "b"])\n');
    expect(ws.playlists()).toEqual([
      {
        path: "_playlists/ete-2026.k7x",
        name: "ete-2026",
        title: "Été 2026",
        count: 1,
        ok: true,
      },
      // No title: the file's stem stands in, which is what the row shows.
      {
        path: "_playlists/live/repet.k7x",
        name: "repet",
        count: 2,
        ok: true,
      },
    ]);
  });

  it("lists a file that does NOT parse, so you can click it and fix it", () => {
    write("_playlists/cassee.k7x", "items([\n");
    const [p] = ws.playlists();
    // A listing that hid it would leave you unable to open the one thing you have to repair.
    expect(p).toMatchObject({ name: "cassee", count: 0, ok: false });
  });

  it("looks beside the active project, not inside it", () => {
    // Rooting the walk at the active project would give a workspace of four songs four set lists.
    write("_playlists/mine.k7x", "items([])\n");
    write("song.k7/_playlists/not-mine.k7x", "items([])\n");
    expect(ws.playlists().map((p) => p.path)).toEqual(["_playlists/mine.k7x"]);
  });

  it("ignores what is not a .k7x", () => {
    write("_playlists/notes.txt", "pas une playlist\n");
    write("_playlists/old.yaml", "items: []\n");
    write("_playlists/ok.k7x", "items([])\n");
    expect(ws.playlists().map((p) => p.name)).toEqual(["ok"]);
  });
});

// `Workspace.createPlaylist`'s five cases moved with the behaviour, to @studio/commands' `playlist.test.ts`.
