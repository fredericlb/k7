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
    writeFileSync(join(dir, "project.yaml"), "name: winter\n");
    writeFileSync(join(dir, "modules", "bass.yaml"), "kind: sampler\n");
    writeFileSync(join(dir, "kick.wav.cache"), "peaks");
    writeFileSync(join(dir, "node_modules", "x.js"), "//");
  }
  return root;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fs-copy-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  USER = `someone-${process.pid}-${n++}@example.com`;
  mkdirSync(rootDir(), { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("copyProjectBetween", () => {
  it("copies the project's content and drops what is not content", async () => {
    workspace("songs", "winter.st0");
    const dest = workspace("albums");

    const { project } = await copyProjectBetween(
      USER,
      "songs",
      "winter.st0",
      "albums",
      "winter.st0",
    );

    expect(project).toBe("winter.st0");
    const at = join(dest, "winter.st0");
    expect(readFileSync(join(at, "project.yaml"), "utf8")).toContain("winter");
    expect(existsSync(join(at, "modules", "bass.yaml"))).toBe(true);
    // The workspace's own idea of what is not content: caches and deps stay behind.
    expect(existsSync(join(at, "kick.wav.cache"))).toBe(false);
    expect(existsSync(join(at, "node_modules"))).toBe(false);
    // The source is untouched — a copy is not a move.
    expect(existsSync(join(rootDir(), "songs", "winter.st0"))).toBe(true);
  });

  it("renames the copy, keeping the suffix that decides which app opens it", async () => {
    workspace("songs", "winter.st0");
    workspace("albums");

    const { project } = await copyProjectBetween(
      USER,
      "songs",
      "winter.st0",
      "albums",
      "spring.st0",
    );

    expect(project).toBe("spring.st0");
    expect(existsSync(join(rootDir(), "albums", "spring.st0"))).toBe(true);
  });

  it("refuses a name whose suffix is not the source's", async () => {
    workspace("songs", "winter.st0");
    workspace("albums");

    await expect(
      copyProjectBetween(USER, "songs", "winter.st0", "albums", "winter.z0"),
    ).rejects.toThrow(/suffix/);
  });

  it("refuses to clobber a project already there", async () => {
    workspace("songs", "winter.st0");
    workspace("albums", "winter.st0");

    await expect(
      copyProjectBetween(USER, "songs", "winter.st0", "albums", "winter.st0"),
    ).rejects.toThrow(/already exists/);
  });

  it("refuses a source that is not a project", async () => {
    const src = workspace("songs", "winter.st0");
    mkdirSync(join(src, "notes"));
    workspace("albums");

    await expect(
      copyProjectBetween(USER, "songs", "notes", "albums", "notes.st0"),
    ).rejects.toThrow(/not a project/);
  });

  it("refuses a destination that is itself one project, where the copy would never list", async () => {
    workspace("songs", "winter.st0");
    const single = join(rootDir(), "solo.st0");
    mkdirSync(single, { recursive: true });
    writeFileSync(join(single, "project.yaml"), "name: solo\n");

    await expect(
      copyProjectBetween(USER, "songs", "winter.st0", "solo.st0", "winter.st0"),
    ).rejects.toThrow(/itself a project/);
  });

  it("is a 404-shaped refusal when a workspace is not on this machine", async () => {
    workspace("songs", "winter.st0");

    await expect(
      copyProjectBetween(USER, "songs", "winter.st0", "nowhere", "winter.st0"),
    ).rejects.toThrow(/unknown workspace/);
  });
});
