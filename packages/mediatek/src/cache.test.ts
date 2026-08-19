import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  heldManifest,
  isStale,
  markSynced,
  seenRevision,
  syncFamily,
} from "./cache.ts";
import { ensureLayout } from "./layout.ts";
import type { Manifest } from "./manifest.ts";
import type { LibrarySource } from "./remote.ts";
import type { Family } from "./types.ts";

// A library source with no server: `download` writes the bytes it was given. The sync is
// written against the port precisely so this is possible — see remote.ts.
function fakeOwner(
  files: Record<string, { body: string; mtime: number }>,
  opts: { failOn?: string; revision?: string } = {},
): LibrarySource {
  return {
    revisions: async () =>
      ({
        songs: "",
        samples: "",
        playlists: opts.revision ?? "r1",
      }) as Record<Family, string>,
    manifest: async (): Promise<Manifest> =>
      Object.entries(files)
        .map(([path, f]) => ({
          path,
          bytes: Buffer.byteLength(f.body),
          mtime: f.mtime,
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    download: async (path, dest) => {
      if (path === opts.failOn) throw new Error("boom");
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, files[path].body, "utf8");
    },
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-cache-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("syncing a family", () => {
  it("fetches everything on a cold cache", async () => {
    const owner = fakeOwner({
      "playlists/instruments/synth/module.yaml": {
        body: "plugin: {}\n",
        mtime: 1,
      },
      "playlists/instruments/synth/lead.yaml": {
        body: "params: {}\n",
        mtime: 2,
      },
    });
    const r = await syncFamily(owner, "playlists");
    expect(r.fetched.length).toBe(2);
    expect(r.failed).toEqual([]);
    expect(read("playlists/instruments/synth/module.yaml")).toBe(
      "plugin: {}\n",
    );
  });

  it("fetches nothing the second time", async () => {
    const owner = fakeOwner({ "playlists/a.yaml": { body: "a\n", mtime: 1 } });
    await syncFamily(owner, "playlists");
    const again = await syncFamily(owner, "playlists");
    expect(again.fetched).toEqual([]);
    expect(again.dropped).toEqual([]);
  });

  it("re-fetches a file the owner changed, on mtime alone", async () => {
    // The local copy has its own mtime and its own size may be identical; only the OWNER's
    // description moves, which is exactly what the remembered manifest exists to see.
    const owner = fakeOwner({ "playlists/a.yaml": { body: "a\n", mtime: 1 } });
    await syncFamily(owner, "playlists");
    const moved = fakeOwner({ "playlists/a.yaml": { body: "b\n", mtime: 9 } });
    const r = await syncFamily(moved, "playlists");
    expect(r.fetched).toEqual(["playlists/a.yaml"]);
    expect(read("playlists/a.yaml")).toBe("b\n");
  });

  it("drops what the owner no longer has", async () => {
    const owner = fakeOwner({
      "playlists/a.yaml": { body: "a\n", mtime: 1 },
      "playlists/b.yaml": { body: "b\n", mtime: 1 },
    });
    await syncFamily(owner, "playlists");
    const fewer = fakeOwner({ "playlists/a.yaml": { body: "a\n", mtime: 1 } });
    const r = await syncFamily(fewer, "playlists");
    expect(r.dropped).toEqual(["playlists/b.yaml"]);
    expect(existsSync(join(root, "playlists/b.yaml"))).toBe(false);
  });

  it("fetches only what a scope accepts", async () => {
    // A machine caches the entries its songs reach for, not the whole catalogue.
    const owner = fakeOwner({
      "playlists/audio/wanted/module.yaml": { body: "w\n", mtime: 1 },
      "playlists/audio/other/module.yaml": { body: "o\n", mtime: 1 },
    });
    const r = await syncFamily(owner, "playlists", (p) =>
      p.startsWith("playlists/audio/wanted/"),
    );
    expect(r.fetched).toEqual(["playlists/audio/wanted/module.yaml"]);
    expect(existsSync(join(root, "playlists/audio/other/module.yaml"))).toBe(
      false,
    );
  });

  it("never drops what is merely out of scope", async () => {
    // The trap the scope has to avoid: narrowing `want` alone makes everything else look
    // like a file the owner deleted, and the first narrow sync empties the cache.
    const owner = fakeOwner({
      "playlists/audio/a/module.yaml": { body: "a\n", mtime: 1 },
      "playlists/audio/b/module.yaml": { body: "b\n", mtime: 1 },
    });
    await syncFamily(owner, "playlists");
    const r = await syncFamily(owner, "playlists", (p) =>
      p.startsWith("playlists/audio/a/"),
    );
    expect(r.dropped).toEqual([]);
    expect(existsSync(join(root, "playlists/audio/b/module.yaml"))).toBe(true);
    // …and it is still REMEMBERED, or the next full sync would fetch it all over again.
    expect(heldManifest("playlists").map((e) => e.path)).toEqual([
      "playlists/audio/a/module.yaml",
      "playlists/audio/b/module.yaml",
    ]);
  });

  it("leaves no half-written file behind when a download fails", async () => {
    // Downloaded to `.part` and renamed, because the moteur may be reading this tree.
    const owner = fakeOwner(
      {
        "playlists/ok.yaml": { body: "ok\n", mtime: 1 },
        "playlists/bad.yaml": { body: "bad\n", mtime: 1 },
      },
      { failOn: "playlists/bad.yaml" },
    );
    const r = await syncFamily(owner, "playlists");
    expect(r.fetched).toEqual(["playlists/ok.yaml"]);
    expect(r.failed.map((f) => f.path)).toEqual(["playlists/bad.yaml"]);
    expect(existsSync(join(root, "playlists/bad.yaml"))).toBe(false);
    expect(existsSync(join(root, "playlists/bad.yaml.part"))).toBe(false);
  });

  it("remembers only what actually landed, so a failure is retried", async () => {
    const failing = fakeOwner(
      {
        "playlists/ok.yaml": { body: "ok\n", mtime: 1 },
        "playlists/bad.yaml": { body: "bad\n", mtime: 1 },
      },
      { failOn: "playlists/bad.yaml" },
    );
    await syncFamily(failing, "playlists");
    expect(heldManifest("playlists").map((e) => e.path)).toEqual([
      "playlists/ok.yaml",
    ]);
    const healed = fakeOwner({
      "playlists/ok.yaml": { body: "ok\n", mtime: 1 },
      "playlists/bad.yaml": { body: "bad\n", mtime: 1 },
    });
    expect((await syncFamily(healed, "playlists")).fetched).toEqual([
      "playlists/bad.yaml",
    ]);
  });

  it("keeps its bookkeeping out of the library's own content", async () => {
    // Under .cache/, which both the family walk and the revision token skip — otherwise
    // writing the manifest would invalidate the very token it was written for.
    const owner = fakeOwner({ "playlists/a.yaml": { body: "a\n", mtime: 1 } });
    await syncFamily(owner, "playlists");
    expect(existsSync(join(root, ".cache", "manifest", "playlists.json"))).toBe(
      true,
    );
  });
});

describe("staleness", () => {
  it("is stale until told otherwise, and in step once marked", async () => {
    const owner = fakeOwner({}, { revision: "r7" });
    expect(seenRevision("playlists")).toBe("");
    expect(await isStale(owner, "playlists")).toBe(true);
    markSynced("playlists", "r7");
    expect(await isStale(owner, "playlists")).toBe(false);
  });

  it("goes stale again when the owner moves", async () => {
    markSynced("playlists", "r7");
    expect(await isStale(fakeOwner({}, { revision: "r8" }), "playlists")).toBe(
      true,
    );
  });
});
