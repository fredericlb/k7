// The loop that keeps this machine's médiathèque cache current. The pieces it drives are
// tested where they live (the manifest diff in @studio/mediatek, the ref inventory in
// @studio/song); what is pinned here is the loop's own judgement — what it fetches, when it
// decides nothing has to happen, and what it tells the rest of the service afterwards.

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
vi.mock("@studio/mediatek/remote", () => ({
  remoteLibrary: () => ({
    revisions: async () => ({ modules: revision }),
    manifest: async () => {
      manifests++;
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
let song: string;

/** A project that USES one of the library's modules — an instance extending it. */
function project(extendsRef: string): string {
  const dir = join(ws, "song");
  mkdirSync(join(dir, "instances"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "instances", "wah.yaml"),
    `extends: "${extendsRef}"\n`,
    "utf8",
  );
  return dir;
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "fs-pull-cache-"));
  ws = mkdtempSync(join(tmpdir(), "fs-pull-ws-"));
  // A scratch HOME, because "no library configured" now also means "none advertised on this
  // machine" — and the developer running these tests has one advertised. Both variables:
  // `homedir()` reads one or the other. See mediatekLink.ts.
  home = mkdtempSync(join(tmpdir(), "fs-pull-home-"));
  realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.STUDIO_MEDIATEK = cache;
  process.env.MEDIATEK_URL = "http://library.test";
  library = {
    "modules/audio/filter/auto-wah/module.yaml": "plugin: {type: internal}\n",
    "modules/audio/filter/auto-wah/auto-wah.ts": "// dsp\n",
    "modules/audio/other/thing/module.yaml": "plugin: {type: internal}\n",
  };
  revision = "r1";
  manifests = 0;
  song = project("@mediatek/audio/filter/auto-wah");
  open = [{ dir: song, invalidated: 0 }];
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
  it("fetches the whole folder of a module the song names, and nothing else", async () => {
    await pullOnce();
    expect(cached("modules/audio/filter/auto-wah/module.yaml")).toBe(true);
    // The dsp source comes too: a module is its folder, and one without it loads nothing.
    expect(cached("modules/audio/filter/auto-wah/auto-wah.ts")).toBe(true);
    expect(cached("modules/audio/other/thing/module.yaml")).toBe(false);
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
    library["modules/audio/filter/auto-wah/module.yaml"] =
      "plugin: {type: vst3}\n";
    revision = "r2";
    await pullOnce();
    expect(manifests).toBe(2);
  });

  it("syncs again when a song starts naming something new, at the same revision", async () => {
    // The case a change token cannot see: nothing moved on the server, but this machine now
    // needs a module it never held.
    await pullOnce();
    rmSync(song, { recursive: true, force: true });
    open = [{ dir: project("@mediatek/audio/other/thing"), invalidated: 0 }];
    await pullOnce();
    expect(cached("modules/audio/other/thing/module.yaml")).toBe(true);
  });

  it("keeps what is no longer named — a scope is not a deletion", async () => {
    await pullOnce();
    rmSync(song, { recursive: true, force: true });
    open = [{ dir: project("@mediatek/audio/other/thing"), invalidated: 0 }];
    await pullOnce();
    expect(cached("modules/audio/filter/auto-wah/module.yaml")).toBe(true);
  });

  it("does nothing at all with no hosted library configured", async () => {
    delete process.env.MEDIATEK_URL;
    await pullOnce();
    expect(cached("modules/audio/filter/auto-wah/module.yaml")).toBe(false);
  });

  it("does nothing when no open song names the library", async () => {
    open = [{ dir: null, invalidated: 0 }];
    await pullOnce();
    expect(manifests).toBe(0);
  });
});
