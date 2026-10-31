// A project copied into another workspace: what lands, what is refused, and what is left out.
// Through `copyProjectBetween`, which is the only caller that names two workspaces.

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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyProjectBetween } from "./copyProject.ts";
import { rootDir } from "./slug.ts";

let home: string;
let USER = "";
let n = 0;

/** A workspace holding one project, with a cache file and a node_modules the copy must drop. */
function workspace(name: string, project?: string): string {
  const root = join(rootDir(), name);
  mkdirSync(root, { recursive: true });
  if (project) {
    const dir = join(root, project);
    mkdirSync(join(dir, "modules"), { recursive: true });
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "project.k7x"), 'name("winter")\n');
    writeFileSync(join(dir, "modules", "bass.k7x"), 'kind("sampler")\n');
    writeFileSync(join(dir, "kick.wav.cache"), "peaks");
    writeFileSync(join(dir, "node_modules", "x.js"), "//");
  }
  return root;
}

/** The same, with a `turntables` surface naming a playlist that lives at the workspace ROOT. */
function deckWorkspace(): string {
  const root = workspace("songs", "winter.k7");
  mkdirSync(join(root, "winter.k7", "surfaces"), { recursive: true });
  writeFileSync(
    join(root, "winter.k7", "surfaces", "decks.k7x"),
    'type("turntables")\nlayout("split")\nplaylist("Fred")\n',
  );
  mkdirSync(join(root, "_playlists"), { recursive: true });
  writeFileSync(
    join(root, "_playlists", "Fred.k7x"),
    'items([{ song: "a" }])\n',
  );
  return root;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fs-copy-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  // `$STUDIO_HOME` wins over HOME, so it must be pinned too.
  process.env.STUDIO_HOME = join(home, ".k7");
  USER = `someone-${process.pid}-${n++}@example.com`;
  mkdirSync(rootDir(), { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("copyProjectBetween", () => {
  it("copies the project's content and drops what is not content", async () => {
    workspace("songs", "winter.k7");
    const dest = workspace("albums");

    const { project } = await copyProjectBetween(
      USER,
      "songs",
      "winter.k7",
      "albums",
      "winter.k7",
    );

    expect(project).toBe("winter.k7");
    const at = join(dest, "winter.k7");
    expect(readFileSync(join(at, "project.k7x"), "utf8")).toContain("winter");
    expect(existsSync(join(at, "modules", "bass.k7x"))).toBe(true);
    // The workspace's own idea of what is not content: caches and deps stay behind.
    expect(existsSync(join(at, "kick.wav.cache"))).toBe(false);
    expect(existsSync(join(at, "node_modules"))).toBe(false);
    // The source is untouched — a copy is not a move.
    expect(existsSync(join(rootDir(), "songs", "winter.k7"))).toBe(true);
  });

  it("carries the playlist a surface names, which lives at the workspace root", async () => {
    const src = deckWorkspace();
    const dest = workspace("albums");

    const r = await copyProjectBetween(
      USER,
      "songs",
      "winter.k7",
      "albums",
      "winter.k7",
    );

    expect(r.playlists).toEqual(["_playlists/Fred.k7x"]);
    expect(
      readFileSync(join(dest, "_playlists", "Fred.k7x"), "utf8"),
    ).toContain('song: "a"');
    // The source keeps its own, untouched.
    expect(readFileSync(join(src, "_playlists", "Fred.k7x"), "utf8")).toContain(
      'song: "a"',
    );
  });

  it("leaves a playlist the destination already has alone — its own set list wins", async () => {
    deckWorkspace();
    const dest = workspace("albums");
    mkdirSync(join(dest, "_playlists"), { recursive: true });
    writeFileSync(
      join(dest, "_playlists", "Fred.k7x"),
      'items([{ song: "b" }])\n',
    );

    const r = await copyProjectBetween(
      USER,
      "songs",
      "winter.k7",
      "albums",
      "winter.k7",
    );

    expect(r.playlists).toBeUndefined();
    expect(
      readFileSync(join(dest, "_playlists", "Fred.k7x"), "utf8"),
    ).toContain('song: "b"');
  });

  it("renames the copy, keeping the suffix that decides which app opens it", async () => {
    workspace("songs", "winter.k7");
    workspace("albums");

    const { project } = await copyProjectBetween(
      USER,
      "songs",
      "winter.k7",
      "albums",
      "spring.k7",
    );

    expect(project).toBe("spring.k7");
    expect(existsSync(join(rootDir(), "albums", "spring.k7"))).toBe(true);
  });

  it("refuses a name whose suffix is not the source's", async () => {
    workspace("songs", "winter.k7");
    workspace("albums");

    await expect(
      copyProjectBetween(USER, "songs", "winter.k7", "albums", "winter.v1"),
    ).rejects.toThrow(/suffix/);
  });

  it("refuses to clobber a project already there", async () => {
    workspace("songs", "winter.k7");
    workspace("albums", "winter.k7");

    await expect(
      copyProjectBetween(USER, "songs", "winter.k7", "albums", "winter.k7"),
    ).rejects.toThrow(/already exists/);
  });

  it("refuses a source that is not a project", async () => {
    const src = workspace("songs", "winter.k7");
    mkdirSync(join(src, "notes"));
    workspace("albums");

    await expect(
      copyProjectBetween(USER, "songs", "notes", "albums", "notes.k7"),
    ).rejects.toThrow(/not a project/);
  });

  it("refuses a destination that is itself one project, where the copy would never list", async () => {
    workspace("songs", "winter.k7");
    const single = join(rootDir(), "solo.k7");
    mkdirSync(single, { recursive: true });
    writeFileSync(join(single, "project.k7x"), 'name("solo")\n');

    await expect(
      copyProjectBetween(USER, "songs", "winter.k7", "solo.k7", "winter.k7"),
    ).rejects.toThrow(/itself a project/);
  });

  it("is a 404-shaped refusal when a workspace is not on this machine", async () => {
    workspace("songs", "winter.k7");

    await expect(
      copyProjectBetween(USER, "songs", "winter.k7", "nowhere", "winter.k7"),
    ).rejects.toThrow(/unknown workspace/);
  });

  it("carries the @workspace modules the project names, and the ones they name, but not over the destination's own", async () => {
    const src = workspace("songs", "winter.k7");
    mkdirSync(join(src, "winter.k7", "chains"), { recursive: true });
    writeFileSync(
      join(src, "winter.k7", "chains", "melody.k7x"),
      'id("a").extends("@workspace/instruments/synth"),\n',
    );
    mkdirSync(join(src, "_modules", "instruments", "synth"), {
      recursive: true,
    });
    writeFileSync(
      join(src, "_modules", "instruments", "synth", "module.k7x"),
      'extends("@workspace/fx/shine.k7x")\n',
    );
    mkdirSync(join(src, "_modules", "fx"), { recursive: true });
    writeFileSync(join(src, "_modules", "fx", "shine.k7x"), 'kind("fx")\n');
    const dest = workspace("albums");
    mkdirSync(join(dest, "_modules", "fx"), { recursive: true });
    writeFileSync(join(dest, "_modules", "fx", "shine.k7x"), 'kind("mine")\n');

    const r = await copyProjectBetween(
      USER,
      "songs",
      "winter.k7",
      "albums",
      "winter.k7",
    );

    expect(r.modules).toEqual(["_modules/instruments/synth"]);
    expect(
      existsSync(join(dest, "_modules", "instruments", "synth", "module.k7x")),
    ).toBe(true);
    expect(
      readFileSync(join(dest, "_modules", "fx", "shine.k7x"), "utf8"),
    ).toContain("mine");
  });
});
