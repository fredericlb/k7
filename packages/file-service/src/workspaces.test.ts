// The machine's workspace listing and creation, against real folders: k7's home page is drawn from
// this, and a project missed at a depth or named by the wrong app is one nobody can open.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveLogFor } from "./liveLog.ts";
import { readLinkRecord, writeLinkRecord } from "./liveServers.ts";
import { attachedAt, detachLiveCapture } from "./liveSync.ts";
import { claimRoot } from "./owner.ts";
// STATIC, not `await import(...)`: paying this module's load in the first test body blew the 5 s timeout.
import { rootDir } from "./slug.ts";
import {
  createWorkspace,
  folderNames,
  getWorkspace,
  joinWorkspace,
  listMachineWorkspaces,
  workspaceNames,
} from "./workspaces.ts";

let home: string;
/** A DIFFERENT user per test, so "nothing on this machine" holds wherever another file's env juggling lands. */
let USER = "";
let n = 0;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fs-ws-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  // `$STUDIO_HOME` wins over HOME, so it must be pinned too.
  process.env.STUDIO_HOME = join(home, ".k7");
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
    mkdirSync(join(root, "songs", "albums", "hiver.k7"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    expect(ws.name).toBe("songs");
    expect(ws.projects).toMatchObject([{ path: "albums/hiver.k7", app: "k7" }]);
  });

  it("reports a workspace that IS a project as one project, named `.`", async () => {
    mkdirSync(join(myRoot(), "hiver.k7"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    expect(ws.isSingleProject).toBe(true);
    // `.` is what every other route calls the workspace root, and what `parseLaunch` answers.
    expect(ws.projects).toMatchObject([{ path: ".", app: "k7" }]);
  });

  it("lists only the folders a suffix claims, each named by its app", async () => {
    const root = myRoot();
    mkdirSync(join(root, "ws", "hiver.k7"), { recursive: true });
    mkdirSync(join(root, "ws", "notes"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    expect(ws.projects).toMatchObject([{ path: "hiver.k7", app: "k7" }]);
  });

  it("says what each project's row draws: its surfaces, whether it is open, its last edit", async () => {
    const root = myRoot();
    const song = join(root, "ws", "hiver.k7");
    mkdirSync(join(song, "surfaces"), { recursive: true });
    writeFileSync(join(song, "project.k7x"), 'project({ name: "hiver" })\n');
    writeFileSync(
      join(song, "surfaces", "timeline.k7x"),
      'type("timeline")\nlayout("split")\n',
    );
    mkdirSync(join(root, "ws", "vide.k7"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    const hiver = ws.projects.find((p) => p.path === "hiver.k7");
    const vide = ws.projects.find((p) => p.path === "vide.k7");
    expect(hiver?.surfaces).toEqual(["timeline"]);
    expect(hiver?.active).toBe(false);
    // A file one folder down counts: that is where a project's nodes and surfaces are edited.
    expect(hiver?.editedAt).toBeGreaterThan(0);
    // An empty folder has no edit to report, and declares no surface — the `live` archetype's shape.
    expect(vide?.editedAt).toBeUndefined();
    expect(vide?.surfaces).toEqual([]);
  });

  // A captured workspace's row is kept while its feed stands still; a project made on disk still shows.
  it("lists a project made on disk in a captured workspace, and the open one as it moves", async () => {
    const root = myRoot();
    mkdirSync(join(root, "ws", "a.k7"), { recursive: true });
    const ws = getWorkspace(USER, "ws");
    try {
      const capture = attachedAt(ws.root)?.capture;
      await vi.waitFor(() => expect(capture?.watching).toBe(true));
      expect((await listMachineWorkspaces(USER))[0].projects).toHaveLength(1);
      const t0 = Date.now();
      vi.useFakeTimers({ now: t0, toFake: ["Date"] });
      vi.setSystemTime(t0 + 6_000);
      ws.setActiveProject("a.k7");
      const [row] = await listMachineWorkspaces(USER);
      expect(row.projects[0].active).toBe(true);
      const gen = capture?.generation ?? 0;
      mkdirSync(join(root, "ws", "b.k7"));
      writeFileSync(join(root, "ws", "b.k7", "project.k7x"), 'project("b")\n');
      vi.useRealTimers();
      await vi.waitFor(
        () => expect(capture?.generation ?? 1).toBeGreaterThan(gen),
        { timeout: 5000, interval: 50 },
      );
      vi.useFakeTimers({ now: Date.now() + 12_000, toFake: ["Date"] });
      const paths = (await listMachineWorkspaces(USER))[0].projects.map(
        (p) => p.path,
      );
      expect(paths).toEqual(["a.k7", "b.k7"]);
    } finally {
      vi.useRealTimers();
      detachLiveCapture(ws.root);
    }
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
    mkdirSync(join(root, "hiver", "a.k7"), { recursive: true });
    expect(await createWorkspace(USER, "hiver")).toBe(false);
    expect(existsSync(join(root, "hiver", "a.k7"))).toBe(true);
  });
});

describe("joinWorkspace", () => {
  it("does nothing before an account has claimed this root", () => {
    const root = myRoot();
    joinWorkspace("band");
    expect(existsSync(join(root, "band"))).toBe(false);
  });

  it("makes a workspace the relay names and this machine lacks, and leaves one already here alone", () => {
    const root = myRoot();
    claimRoot(USER);
    process.env.STUDIO_LIVE_SYNC = "0";
    joinWorkspace("band");
    expect(existsSync(join(root, "band"))).toBe(true);
    joinWorkspace("band");
    expect(readdirSync(root)).toContain("band");
    delete process.env.STUDIO_LIVE_SYNC;
  });
});

describe("the workspaces of a saved server that is not the active one", () => {
  const record = (name: string, link: string) =>
    writeLinkRecord(liveLogFor(join(rootDir(), name)), {
      server: "https://a.test",
      link,
      room: name,
    });

  afterEach(() => {
    delete process.env.STUDIO_SYNC_HIDDEN;
    delete process.env.STUDIO_LIVE_SYNC;
  });

  it("are hidden from every list and refused by name while another is active, and come back once theirs is", async () => {
    const root = myRoot();
    for (const n of ["band", "solo", "mine"]) mkdirSync(join(root, n));
    record("band", "l-band");
    record("mine", "l-mine");
    // Switched to l-mine: the hub names l-band among the hidden links.
    process.env.STUDIO_SYNC_HIDDEN = JSON.stringify([
      { id: "l-band", url: "wss://a.test/api/sync" },
    ]);
    expect(workspaceNames(root)).toEqual(["mine", "solo"]);
    expect(folderNames(root)).toEqual(["band", "mine", "solo"]);
    expect((await listMachineWorkspaces(USER)).map((w) => w.name)).toEqual([
      "mine",
      "solo",
    ]);
    expect(() => getWorkspace(USER, "band")).toThrow(/unknown workspace/);
    // Switched back to l-band: l-mine is the hidden one, and band is listed and opened again.
    process.env.STUDIO_SYNC_HIDDEN = JSON.stringify([
      { id: "l-mine", url: "wss://a.test/api/sync" },
    ]);
    expect(workspaceNames(root)).toEqual(["band", "solo"]);
    process.env.STUDIO_LIVE_SYNC = "0";
    expect(getWorkspace(USER, "band").root).toBe(join(root, "band"));
    expect(existsSync(join(root, "mine"))).toBe(true);
  });

  it("is what a workspace becomes on a machine from its first link: its record names the active server", () => {
    const root = myRoot();
    mkdirSync(join(root, "fresh"));
    const url = "ws://127.0.0.1:9/api/sync";
    process.env.STUDIO_SYNC_URL = url;
    process.env.STUDIO_SYNC_TOKEN = "t";
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      { url, token: "t", main: true, id: "l-active", as: "me@x" },
    ]);
    try {
      const ws = getWorkspace(USER, "fresh");
      expect(readLinkRecord(liveLogFor(ws.root))).toMatchObject({
        link: "l-active",
        room: "fresh",
      });
      detachLiveCapture(ws.root);
    } finally {
      delete process.env.STUDIO_SYNC_URL;
      delete process.env.STUDIO_SYNC_TOKEN;
      delete process.env.STUDIO_SYNC_SERVERS;
    }
  });
});
