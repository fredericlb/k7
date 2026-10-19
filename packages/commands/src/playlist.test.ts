// The workspace's set lists as verbs: `playlist new`, and the three that edit its lines. Four
// things here would be wrong silently — a name that leaves `_playlists/`, an edit that
// RE-SERIALISES the file and eats the comments and order somebody chose, a "create" that hands
// back a set list already there, and a position read off by one from what the screen shows.

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
import { parsePlaylist } from "@studio/song-schema/playlist";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let root: string;
const logs: string[] = [];
const refusals: string[] = [];

/** A host with a WORKSPACE and no project; `null` is the CLI's shape, a song folder alone. */
const host = (repo: string | null = root) =>
  ({
    songPath: join(root, "song.k7"),
    repoDir: repo ?? undefined,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
  }) as never;

const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  root = mkdtempSync(join(tmpdir(), "td-playlist-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("playlist new", () => {
  it("writes a stub that PARSES, and adds the extension", async () => {
    await runCommand("playlist new ete 2026", host(), "cli");
    // Not an empty file, which would open on a parse failure — see docs/playlist.md.
    expect(parsePlaylist(read("_playlists/ete 2026.k7x"))).toEqual({
      title: "ete 2026",
      items: [],
    });
  });

  it("keeps an extension already typed rather than doubling it", async () => {
    await runCommand("playlist new set.k7x", host(), "cli");
    expect(existsSync(join(root, "_playlists/set.k7x"))).toBe(true);
  });

  it("refuses a YAML name, which no workspace file has", async () => {
    await runCommand("playlist new set.yaml", host(), "cli");
    expect(refusals.join(" ")).toMatch(/a playlist is a \.k7x file/);
    expect(existsSync(join(root, "_playlists"))).toBe(false);
  });

  it("makes the subfolder a name asks for", async () => {
    await runCommand("playlist new live/repet", host(), "cli");
    expect(existsSync(join(root, "_playlists/live/repet.k7x"))).toBe(true);
  });

  it("refuses one that is already there rather than opening it", async () => {
    await runCommand("playlist new set", host(), "cli");
    writeFileSync(
      join(root, "_playlists/set.k7x"),
      'title("mine")\nitems([])\n',
    );
    await runCommand("playlist new set", host(), "cli");
    expect(refusals.join(" ")).toMatch(/already there/);
    // The file on disk is untouched by the refusal — see docs/playlist.md.
    expect(read("_playlists/set.k7x")).toContain('title("mine")');
  });

  it("cannot be talked out of the folder, with either separator", async () => {
    // `playlistPathOf` splits on `/`, so containment is checked against the RESOLVED path.
    for (const name of ["../../escaped", "..\\..\\escaped"]) {
      await runCommand(`playlist new ${name}`, host(), "cli");
      expect(refusals.join(" ")).toMatch(/not a playlist name/);
    }
    expect(existsSync(join(root, "..", "escaped.k7x"))).toBe(false);
  });

  it("says there is no workspace rather than writing beside the song", async () => {
    await runCommand("playlist new set", host(null), "cli");
    expect(refusals.join(" ")).toMatch(/no workspace/);
    expect(existsSync(join(root, "_playlists"))).toBe(false);
  });
});

describe("playlist song add", () => {
  const start = (body: string): void => {
    mkdirSync(join(root, "_playlists"), { recursive: true });
    writeFileSync(join(root, "_playlists/set.k7x"), body, "utf8");
  };

  it("appends a bare line, and the song may hold spaces unquoted", async () => {
    start('// ma soirée\ntitle("set")\nitems([])\n');
    await runCommand(
      "playlist song add set AC-DC/Back in Black/Hells Bells",
      host(),
      "cli",
    );
    expect(parsePlaylist(read("_playlists/set.k7x"))?.items).toEqual([
      { song: "AC-DC/Back in Black/Hells Bells" },
    ]);
    // A TEXT edit, never a re-serialisation: the comment somebody wrote is still there.
    expect(read("_playlists/set.k7x")).toContain("// ma soirée");
  });

  it("takes a variant after a QUOTED song, and writes it as a mapping", async () => {
    start('title("set")\nitems([])\n');
    await runCommand(
      'playlist song add set "AC-DC/Back in Black/Hells Bells" live',
      host(),
      "cli",
    );
    expect(parsePlaylist(read("_playlists/set.k7x"))?.items).toEqual([
      { song: "AC-DC/Back in Black/Hells Bells", variant: "live" },
    ]);
  });

  it("keeps the lines already there and counts them", async () => {
    start('title("set")\nitems(["Nirvana/Nevermind/Lithium"])\n');
    await runCommand(
      "playlist song add set Pixies/Doolittle/Debaser",
      host(),
      "cli",
    );
    expect(parsePlaylist(read("_playlists/set.k7x"))?.items).toHaveLength(2);
    expect(logs.join(" ")).toMatch(/2 songs/);
  });

  it("names an unknown playlist rather than making one", async () => {
    await runCommand(
      "playlist song add nope Pixies/Doolittle/Debaser",
      host(),
      "cli",
    );
    expect(refusals.join(" ")).toMatch(/no playlist _playlists\/nope\.k7x/);
    expect(existsSync(join(root, "_playlists/nope.k7x"))).toBe(false);
  });

  it("refuses a shape the append cannot extend, and writes nothing", async () => {
    // An `items` that is not a list — see docs/playlist.md.
    const broken = 'title("set")\nitems("a")\n';
    start(broken);
    await runCommand(
      "playlist song add set Pixies/Doolittle/Debaser",
      host(),
      "cli",
    );
    expect(refusals.join(" ")).toMatch(/not a shape this can extend/);
    expect(read("_playlists/set.k7x")).toBe(broken);
  });
});

// Removing and reordering: document edits counting from 1, so the risks are the ones above plus off-by-one.
describe("playlist song remove / move", () => {
  const three = (): void => {
    mkdirSync(join(root, "_playlists"), { recursive: true });
    writeFileSync(
      join(root, "_playlists/set.k7x"),
      '// ma soirée\ntitle("set")\nitems([\n  "a",\n  song("b").variant("live"),\n  "c",\n])\n',
      "utf8",
    );
  };
  const songs = () =>
    parsePlaylist(read("_playlists/set.k7x"))?.items.map((i) => i.song);

  it("drops the line at a position, keeping the comment", async () => {
    three();
    await runCommand("playlist song remove set 1", host(), "cli");
    expect(songs()).toEqual(["b", "c"]);
    expect(read("_playlists/set.k7x")).toContain("// ma soirée");
  });

  it("takes the variant line with the song it belongs to", async () => {
    three();
    await runCommand("playlist song remove set 2", host(), "cli");
    expect(songs()).toEqual(["a", "c"]);
    expect(read("_playlists/set.k7x")).not.toContain("variant");
  });

  it("leaves an empty list that still PARSES", async () => {
    mkdirSync(join(root, "_playlists"), { recursive: true });
    writeFileSync(join(root, "_playlists/set.k7x"), 'items(["a"])\n', "utf8");
    await runCommand("playlist song remove set 1", host(), "cli");
    expect(parsePlaylist(read("_playlists/set.k7x"))).toEqual({ items: [] });
  });

  it("moves a song, carrying its variant with it", async () => {
    three();
    await runCommand("playlist song move set 2 1", host(), "cli");
    expect(parsePlaylist(read("_playlists/set.k7x"))?.items).toEqual([
      { song: "b", variant: "live" },
      { song: "a" },
      { song: "c" },
    ]);
  });

  it("moves the last song to the front", async () => {
    three();
    await runCommand("playlist song move set 3 1", host(), "cli");
    expect(songs()).toEqual(["c", "a", "b"]);
  });

  it("refuses a position the list has not got, and writes nothing", async () => {
    three();
    const before = read("_playlists/set.k7x");
    await runCommand("playlist song remove set 9", host(), "cli");
    expect(refusals.join(" ")).toMatch(/between 1 and 3/);
    expect(read("_playlists/set.k7x")).toBe(before);
  });

  it("refuses 0, since the screen counts from 1", async () => {
    three();
    await runCommand("playlist song move set 0 2", host(), "cli");
    expect(refusals.join(" ")).toMatch(/both positions go from 1 to 3/);
  });

  it("reads an `items` that is not a list as no song, and writes nothing", async () => {
    mkdirSync(join(root, "_playlists"), { recursive: true });
    const flow = 'title("set")\nitems("a")\n';
    writeFileSync(join(root, "_playlists/set.k7x"), flow, "utf8");
    await runCommand("playlist song move set 1 2", host(), "cli");
    expect(refusals.join(" ")).toMatch(/names no song/);
    expect(read("_playlists/set.k7x")).toBe(flow);
  });

  it("names an unknown playlist rather than making one", async () => {
    await runCommand("playlist song remove nope 1", host(), "cli");
    expect(refusals.join(" ")).toMatch(/no playlist _playlists\/nope\.k7x/);
  });
});
