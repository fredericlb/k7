// The workspace's set lists as verbs: `playlist new` and `playlist song add`. Three things here
// would be wrong silently — a name that leaves `_playlists/` (the check the file service's route
// used to make before making one was a command), an append that RE-SERIALISES the file and eats
// the comments and order somebody chose, and a "create" that hands back a set list already there.

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

/** A host with a WORKSPACE and no project — which is the shape these two verbs are for.
 *  `null` is the CLI's shape: a song folder and no repository around it. */
const host = (repo: string | null = root) =>
  ({
    songPath: join(root, "song.st0"),
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
    // Not an empty file: the screen draws its right-hand pane from the text, so a blank one
    // would open on a parse failure for a playlist nobody has yet had a chance to get wrong.
    expect(parsePlaylist(read("_playlists/ete 2026.yaml"))).toEqual({
      title: "ete 2026",
      items: [],
    });
  });

  it("keeps an extension already typed rather than doubling it", async () => {
    await runCommand("playlist new set.yaml", host(), "cli");
    expect(existsSync(join(root, "_playlists/set.yaml"))).toBe(true);
  });

  it("makes the subfolder a name asks for", async () => {
    await runCommand("playlist new live/repet", host(), "cli");
    expect(existsSync(join(root, "_playlists/live/repet.yaml"))).toBe(true);
  });

  it("refuses one that is already there rather than opening it", async () => {
    await runCommand("playlist new set", host(), "cli");
    writeFileSync(
      join(root, "_playlists/set.yaml"),
      "title: mine\nitems: []\n",
    );
    await runCommand("playlist new set", host(), "cli");
    expect(refusals.join(" ")).toMatch(/already there/);
    // A "create" that quietly handed back somebody else's set list is how you edit the wrong
    // one — so the file on disk is untouched by the refusal.
    expect(read("_playlists/set.yaml")).toContain("title: mine");
  });

  it("cannot be talked out of the folder, with either separator", async () => {
    // `playlistPathOf` splits on `/`, so the BACKSLASH form is one segment to it and three to
    // `join` — which is why the containment check is made against the resolved path.
    for (const name of ["../../escaped", "..\\..\\escaped"]) {
      await runCommand(`playlist new ${name}`, host(), "cli");
      expect(refusals.join(" ")).toMatch(/not a playlist name/);
    }
    expect(existsSync(join(root, "..", "escaped.yaml"))).toBe(false);
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
    writeFileSync(join(root, "_playlists/set.yaml"), body, "utf8");
  };

  it("appends a bare line, and the song may hold spaces unquoted", async () => {
    start("# ma soirée\ntitle: set\nitems: []\n");
    await runCommand(
      "playlist song add set AC-DC/Back in Black/Hells Bells",
      host(),
      "cli",
    );
    expect(parsePlaylist(read("_playlists/set.yaml"))?.items).toEqual([
      { song: "AC-DC/Back in Black/Hells Bells" },
    ]);
    // A TEXT edit, never a re-serialisation: the comment somebody wrote is still there.
    expect(read("_playlists/set.yaml")).toContain("# ma soirée");
  });

  it("takes a variant after a QUOTED song, and writes it as a mapping", async () => {
    start("title: set\nitems: []\n");
    await runCommand(
      'playlist song add set "AC-DC/Back in Black/Hells Bells" live',
      host(),
      "cli",
    );
    expect(parsePlaylist(read("_playlists/set.yaml"))?.items).toEqual([
      { song: "AC-DC/Back in Black/Hells Bells", variant: "live" },
    ]);
  });

  it("keeps the lines already there and counts them", async () => {
    start("title: set\nitems:\n  - Nirvana/Nevermind/Lithium\n");
    await runCommand(
      "playlist song add set Pixies/Doolittle/Debaser",
      host(),
      "cli",
    );
    expect(parsePlaylist(read("_playlists/set.yaml"))?.items).toHaveLength(2);
    expect(logs.join(" ")).toMatch(/2 songs/);
  });

  it("names an unknown playlist rather than making one", async () => {
    await runCommand(
      "playlist song add nope Pixies/Doolittle/Debaser",
      host(),
      "cli",
    );
    expect(refusals.join(" ")).toMatch(/no playlist _playlists\/nope\.yaml/);
    expect(existsSync(join(root, "_playlists/nope.yaml"))).toBe(false);
  });

  it("refuses a shape the append cannot extend, and writes nothing", async () => {
    // A flow sequence spread over lines: inventing a second `items:` key lower down would write a
    // file whose two halves disagree, which is worse than being told to type the line yourself.
    const broken = "title: set\nitems: [\n  a,\n";
    start(broken);
    await runCommand(
      "playlist song add set Pixies/Doolittle/Debaser",
      host(),
      "cli",
    );
    expect(refusals.join(" ")).toMatch(/not a shape this can extend/);
    expect(read("_playlists/set.yaml")).toBe(broken);
  });
});
