// The machine's workspace listing and creation, against real folders: st0's home page is drawn from
// this, and a project missed at a depth or named by the wrong app is one nobody can open.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// STATIC, not `await import(...)`: paying this module's load in the first test body blew the 5 s timeout.
import { rootDir } from "./slug.ts";
import { createWorkspace, listMachineWorkspaces } from "./workspaces.ts";

let home: string;
/** A DIFFERENT user per test, so "nothing on this machine" holds wherever another file's env juggling lands. */
let USER = "";
let n = 0;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fs-ws-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  // `$STUDIO_HOME` wins over HOME, so it must be pinned too.
  process.env.STUDIO_HOME = join(home, ".st0");
  USER = `someone-${process.pid}-${n++}@example.com`;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const myRoot = (): string => {
  const root = rootDir();
  mkdirSync(root, { recursive: true });
  return root;
};

describe("listMachineWorkspaces", () => {
  it("reports a project sitting at a depth, which the flat count missed", async () => {
    const root = myRoot();
    mkdirSync(join(root, "songs", "albums", "hiver.st0"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    expect(ws.name).toBe("songs");
    expect(ws.projects).toEqual([{ path: "albums/hiver.st0", app: "st0" }]);
  });

  it("reports a workspace that IS a project as one project, named `.`", async () => {
    mkdirSync(join(myRoot(), "hiver.st0"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    expect(ws.isSingleProject).toBe(true);
    // `.` is what every other route calls the workspace root, and what `parseLaunch` answers.
    expect(ws.projects).toEqual([{ path: ".", app: "st0" }]);
  });

  it("sees a .z0 beside a .st0, each named by the app its folder claims", async () => {
    const root = myRoot();
    mkdirSync(join(root, "ws", "hiver.st0"), { recursive: true });
    mkdirSync(join(root, "ws", "quiz.z0"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    expect(ws.projects).toEqual([
      { path: "hiver.st0", app: "st0" },
      { path: "quiz.z0", app: "z0" },
    ]);
  });
});

describe("createWorkspace", () => {
  it("makes an empty folder, and is listed at once", async () => {
    myRoot();
    // Listed before, so the cached listing is the one the creation must invalidate.
    expect(await listMachineWorkspaces(USER)).toEqual([]);
    expect(await createWorkspace(USER, "hiver")).toBe(true);
    const dir = join(rootDir(), "hiver");
    expect(readdirSync(dir)).toEqual([]);
    expect((await listMachineWorkspaces(USER)).map((w) => w.name)).toEqual([
      "hiver",
    ]);
  });

  it("answers false for a workspace already there, and leaves it alone", async () => {
    const root = myRoot();
    mkdirSync(join(root, "hiver", "a.st0"), { recursive: true });
    expect(await createWorkspace(USER, "hiver")).toBe(false);
    expect(existsSync(join(root, "hiver", "a.st0"))).toBe(true);
  });
});
