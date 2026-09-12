import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLayout } from "./layout.ts";
import {
  createPlaylist,
  listPlaylists,
  PlaylistExistsError,
  playlistName,
  playlistPath,
} from "./playlists.ts";
import { scanFamily } from "./scan.ts";
import { putFile } from "./write.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-pl-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

describe("naming one", () => {
  it("adds the extension when it is missing and keeps it when it is there", () => {
    expect(playlistPath("ete-2026")).toBe("playlists/ete-2026.yaml");
    expect(playlistPath("ete-2026.yaml")).toBe("playlists/ete-2026.yaml");
    // The zone nests, so a set list may be filed under a folder.
    expect(playlistPath("live/repet")).toBe("playlists/live/repet.yaml");
  });

  it("refuses a name that would leave the zone", () => {
    for (const bad of ["", "  ", "..", "../escape", "live/../../etc/passwd"])
      expect(playlistPath(bad)).toBeNull();
  });

  it("reads a path back as the name that addresses it", () => {
    expect(playlistName("playlists/live/repet.yaml")).toBe("live/repet");
    // Outside the zone, or not a yaml: neither is a playlist.
    expect(playlistName("songs/AC-DC/song.yaml")).toBeNull();
    expect(playlistName("playlists/notes.txt")).toBeNull();
  });
});

describe("creating one", () => {
  it("writes a stub that parses, and lists it", () => {
    const made = createPlaylist("ete-2026");
    expect(made).toMatchObject({
      name: "ete-2026",
      path: "playlists/ete-2026.yaml",
      count: 0,
      ok: true,
    });
    expect(listPlaylists()).toHaveLength(1);
  });

  it("refuses a name already taken rather than handing back the other one", () => {
    createPlaylist("ete-2026");
    expect(() => createPlaylist("ete-2026")).toThrow(PlaylistExistsError);
    // …and the same file under the spelling that carries the extension.
    expect(() => createPlaylist("ete-2026.yaml")).toThrow(PlaylistExistsError);
  });
});

describe("the listing", () => {
  it("reads the title and the count, and falls back to the name", () => {
    putFile(
      "playlists/ete-2026.yaml",
      "title: Été 2026\nitems:\n  - AC-DC/Back in Black/Hells Bells\n  - song: Nirvana/Nevermind/Lithium\n    variant: instrumental\n",
    );
    putFile(
      "playlists/untitled.yaml",
      "items:\n  - Miles/Kind of Blue/So What\n",
    );
    const by = Object.fromEntries(listPlaylists().map((p) => [p.name, p]));
    expect(by["ete-2026"]).toMatchObject({
      title: "Été 2026",
      count: 2,
      ok: true,
    });
    // No `title:` — the surface falls back to the name, so the field is simply absent.
    expect(by.untitled?.title).toBeUndefined();
    expect(by.untitled?.count).toBe(1);
  });

  it("lists a file that does not parse, so the one needing repair is reachable", () => {
    putFile("playlists/broken.yaml", "items: [unclosed\n");
    const [only] = listPlaylists();
    expect(only).toMatchObject({ name: "broken", ok: false, count: 0 });
  });

  it("finds one at any depth, and ignores what is not a yaml", () => {
    createPlaylist("live/thursday");
    putFile("playlists/notes.txt", "not a playlist");
    expect(listPlaylists().map((p) => p.name)).toEqual(["live/thursday"]);
  });

  it("is empty rather than throwing on a volume with no zone", () => {
    rmSync(join(root, "playlists"), { recursive: true, force: true });
    expect(listPlaylists()).toEqual([]);
  });
});

describe("the zone is not a family", () => {
  it("stays out of the songs scan, holding no bytes to catalogue", () => {
    createPlaylist("ete-2026");
    expect(scanFamily("songs")).toEqual([]);
  });
});
