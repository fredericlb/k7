// The loop that keeps this machine's médiathèque cache current. The pieces it drives are
// tested where they live (the manifest diff in @studio/mediatek, the ref inventory in
// @studio/song); what is pinned here is the loop's own judgement — what it fetches, when it
// decides nothing has to happen, and what it tells the rest of the service afterwards.
//
// It fetches SONGS and nothing else. Modules and chains live in the account's library
// repository, mounted per workspace as a git submodule, and a folder git owns must have exactly
// one writer — `syncFamily` deletes whatever the owner's manifest does not list. See
// packages/song/docs/sharedFolders.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The open songs, as the request path would have memoised them. */
let open: { dir: string | null; invalidated: number }[] = [];
vi.mock("./workspaces.ts", () => ({
  liveWorkspaces: () =>
    open.map((w) => ({
      // The workspace ROOT as well as the project dir: a set's playlist lives at the top of the repository.
      root: ws,
      activeProjectPath: () => w.dir,
      invalidateProjectDoc: () => {
        w.invalidated++;
      },
    })),
}));

/** The hosted library: a manifest and bytes, with no server. */
let library: Record<string, string> = {};
let revision = "r1";
let manifests = 0;
/** Every family the loop asked a manifest for, so a test can prove one was never asked. */
let asked: string[] = [];
vi.mock("@studio/mediatek/remote", () => ({
  remoteLibrary: () => ({
    revisions: async () => ({ songs: revision, modules: revision }),
    manifest: async (family: string) => {
      manifests++;
      asked.push(family);
      return Object.entries(library).map(([path, body]) => ({
        path,
        bytes: Buffer.byteLength(body),
        mtime: 1,
      }));
    },
    download: async (path: string, dest: string) => {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, library[path], "utf8");
    },
  }),
}));

const { pullOnce, stopMediatekPuller } = await import("./mediatekPull.ts");

let cache: string;
let ws: string;
let home: string;
let realHome: { HOME?: string; USERPROFILE?: string };
let set: string;

/** A SET whose desk points at a playlist: TWO files in two places, and this loop walks both. */
function project(...refs: string[]): string {
  const dir = join(ws, "set");
  mkdirSync(join(dir, "surfaces"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: set\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "surfaces", "desk.yaml"),
    "type: turntables\nlayout: split\nplaylist: ce-soir\n",
    "utf8",
  );
  mkdirSync(join(ws, "_playlists"), { recursive: true });
  // The playlist's lines carry no family, so the full refs the callers pass are trimmed here.
  writeFileSync(
    join(ws, "_playlists", "ce-soir.yaml"),
    `items:\n${refs.map((r) => `  - ${r.replace(/^@st0\/songs\//, "")}\n`).join("")}`,
    "utf8",
  );
  return dir;
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "fs-pull-cache-"));
  ws = mkdtempSync(join(tmpdir(), "fs-pull-ws-"));
  // A scratch HOME, so the developer's own advertised library cannot count as "one configured".
  home = mkdtempSync(join(tmpdir(), "fs-pull-home-"));
  realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.STUDIO_MEDIATEK = cache;
  process.env.MEDIATEK_URL = "http://library.test";
  library = {
    "songs/lemo/mante/danse/song.yaml": "title: Danse\n",
    "songs/lemo/mante/danse/master.wav": "RIFF\n",
    "songs/lemo/mante/aube/song.yaml": "title: Aube\n",
    "modules/audio/filter/auto-wah/module.yaml": "plugin: {type: internal}\n",
  };
  revision = "r1";
  manifests = 0;
  asked = [];
  set = project("@st0/songs/lemo/mante/danse");
  open = [{ dir: set, invalidated: 0 }];
});
afterEach(() => {
  stopMediatekPuller();
  delete process.env.STUDIO_MEDIATEK;
  delete process.env.MEDIATEK_URL;
  for (const [k, v] of Object.entries(realHome))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  rmSync(cache, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const cached = (rel: string) => existsSync(join(cache, rel));

describe("pulling the médiathèque", () => {
  it("fetches the whole folder of a song the set names, and nothing else", async () => {
    await pullOnce();
    expect(cached("songs/lemo/mante/danse/song.yaml")).toBe(true);
    // The master comes too: the machine that plays it opens a file path, not a listing.
    expect(cached("songs/lemo/mante/danse/master.wav")).toBe(true);
    expect(cached("songs/lemo/mante/aube/song.yaml")).toBe(false);
  });

  it("never fetches modules — git owns that folder now", async () => {
    // Two writers on one tree: `syncFamily` drops whatever the owner's manifest omits.
    await pullOnce();
    expect(asked).not.toContain("modules");
    expect(cached("modules/audio/filter/auto-wah/module.yaml")).toBe(false);
  });

  it("tells the open songs to recompile, but only when something landed", async () => {
    await pullOnce();
    expect(open[0].invalidated).toBe(1);
    await pullOnce();
    expect(open[0].invalidated).toBe(1);
  });

  it("asks the owner nothing more than its token while neither side moves", async () => {
    await pullOnce();
    expect(manifests).toBe(1);
    await pullOnce();
    expect(manifests).toBe(1); // the revision answered it — no manifest, no diff
  });

  it("refetches when the library moves", async () => {
    await pullOnce();
    library["songs/lemo/mante/danse/song.yaml"] = "title: Danse (edit)\n";
    revision = "r2";
    await pullOnce();
    expect(manifests).toBe(2);
  });

  it("syncs again when a set starts naming something new, at the same revision", async () => {
    // The case a change token cannot see: this machine now needs a song it never held.
    await pullOnce();
    rmSync(set, { recursive: true, force: true });
    open = [{ dir: project("@st0/songs/lemo/mante/aube"), invalidated: 0 }];
    await pullOnce();
    expect(cached("songs/lemo/mante/aube/song.yaml")).toBe(true);
  });

  it("keeps what is no longer named — a scope is not a deletion", async () => {
    await pullOnce();
    rmSync(set, { recursive: true, force: true });
    open = [{ dir: project("@st0/songs/lemo/mante/aube"), invalidated: 0 }];
    await pullOnce();
    expect(cached("songs/lemo/mante/danse/song.yaml")).toBe(true);
  });

  it("does nothing at all with no hosted library configured", async () => {
    delete process.env.MEDIATEK_URL;
    await pullOnce();
    expect(cached("songs/lemo/mante/danse/song.yaml")).toBe(false);
  });

  it("does nothing when no open project names the library", async () => {
    open = [{ dir: null, invalidated: 0 }];
    await pullOnce();
    expect(manifests).toBe(0);
  });
});
