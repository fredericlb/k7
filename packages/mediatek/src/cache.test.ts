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

// A library source with no server, which is what `LibrarySource` being a port is for.
function fakeOwner(
  files: Record<string, { body: string; mtime: number }>,
  opts: { failOn?: string; revision?: string } = {},
): LibrarySource {
  return {
    revisions: async () =>
      ({
        songs: "",
        samples: opts.revision ?? "r1",
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
      "samples/instruments/synth/module.yaml": {
        body: "plugin: {}\n",
        mtime: 1,
      },
      "samples/instruments/synth/lead.yaml": {
        body: "params: {}\n",
        mtime: 2,
      },
    });
    const r = await syncFamily(owner, "samples");
    expect(r.fetched.length).toBe(2);
    expect(r.failed).toEqual([]);
    expect(read("samples/instruments/synth/module.yaml")).toBe("plugin: {}\n");
  });

  it("fetches nothing the second time", async () => {
    const owner = fakeOwner({ "samples/a.yaml": { body: "a\n", mtime: 1 } });
    await syncFamily(owner, "samples");
    const again = await syncFamily(owner, "samples");
    expect(again.fetched).toEqual([]);
    expect(again.dropped).toEqual([]);
  });

  it("re-fetches a file the owner changed, on mtime alone", async () => {
    // Only the OWNER's description moves, which is what the remembered manifest exists to see.
    const owner = fakeOwner({ "samples/a.yaml": { body: "a\n", mtime: 1 } });
    await syncFamily(owner, "samples");
    const moved = fakeOwner({ "samples/a.yaml": { body: "b\n", mtime: 9 } });
    const r = await syncFamily(moved, "samples");
    expect(r.fetched).toEqual(["samples/a.yaml"]);
    expect(read("samples/a.yaml")).toBe("b\n");
  });

  it("drops what the owner no longer has", async () => {
    const owner = fakeOwner({
      "samples/a.yaml": { body: "a\n", mtime: 1 },
      "samples/b.yaml": { body: "b\n", mtime: 1 },
    });
    await syncFamily(owner, "samples");
    const fewer = fakeOwner({ "samples/a.yaml": { body: "a\n", mtime: 1 } });
    const r = await syncFamily(fewer, "samples");
    expect(r.dropped).toEqual(["samples/b.yaml"]);
    expect(existsSync(join(root, "samples/b.yaml"))).toBe(false);
  });

  it("fetches only what a scope accepts", async () => {
    // A machine caches the entries its songs reach for, not the whole catalogue.
    const owner = fakeOwner({
      "samples/audio/wanted/module.yaml": { body: "w\n", mtime: 1 },
      "samples/audio/other/module.yaml": { body: "o\n", mtime: 1 },
    });
    const r = await syncFamily(owner, "samples", (p) =>
      p.startsWith("samples/audio/wanted/"),
    );
    expect(r.fetched).toEqual(["samples/audio/wanted/module.yaml"]);
    expect(existsSync(join(root, "samples/audio/other/module.yaml"))).toBe(
      false,
    );
  });

  it("never drops what is merely out of scope", async () => {
    // The trap: narrowing `want` alone makes everything else look deleted (docs/sync.md).
    const owner = fakeOwner({
      "samples/audio/a/module.yaml": { body: "a\n", mtime: 1 },
      "samples/audio/b/module.yaml": { body: "b\n", mtime: 1 },
    });
    await syncFamily(owner, "samples");
    const r = await syncFamily(owner, "samples", (p) =>
      p.startsWith("samples/audio/a/"),
    );
    expect(r.dropped).toEqual([]);
    expect(existsSync(join(root, "samples/audio/b/module.yaml"))).toBe(true);
    // …and it is still REMEMBERED, or the next full sync would fetch it all over again.
    expect(heldManifest("samples").map((e) => e.path)).toEqual([
      "samples/audio/a/module.yaml",
      "samples/audio/b/module.yaml",
    ]);
  });

  it("leaves no half-written file behind when a download fails", async () => {
    // Downloaded to `.part` and renamed, because the moteur may be reading this tree.
    const owner = fakeOwner(
      {
        "samples/ok.yaml": { body: "ok\n", mtime: 1 },
        "samples/bad.yaml": { body: "bad\n", mtime: 1 },
      },
      { failOn: "samples/bad.yaml" },
    );
    const r = await syncFamily(owner, "samples");
    expect(r.fetched).toEqual(["samples/ok.yaml"]);
    expect(r.failed.map((f) => f.path)).toEqual(["samples/bad.yaml"]);
    expect(existsSync(join(root, "samples/bad.yaml"))).toBe(false);
    expect(existsSync(join(root, "samples/bad.yaml.part"))).toBe(false);
  });

  it("remembers only what actually landed, so a failure is retried", async () => {
    const failing = fakeOwner(
      {
        "samples/ok.yaml": { body: "ok\n", mtime: 1 },
        "samples/bad.yaml": { body: "bad\n", mtime: 1 },
      },
      { failOn: "samples/bad.yaml" },
    );
    await syncFamily(failing, "samples");
    expect(heldManifest("samples").map((e) => e.path)).toEqual([
      "samples/ok.yaml",
    ]);
    const healed = fakeOwner({
      "samples/ok.yaml": { body: "ok\n", mtime: 1 },
      "samples/bad.yaml": { body: "bad\n", mtime: 1 },
    });
    expect((await syncFamily(healed, "samples")).fetched).toEqual([
      "samples/bad.yaml",
    ]);
  });

  it("keeps its bookkeeping out of the library's own content", async () => {
    // Under .cache/, which the walk and the token skip, or writing it would invalidate the token.
    const owner = fakeOwner({ "samples/a.yaml": { body: "a\n", mtime: 1 } });
    await syncFamily(owner, "samples");
    expect(existsSync(join(root, ".cache", "manifest", "samples.json"))).toBe(
      true,
    );
  });
});

describe("staleness", () => {
  it("is stale until told otherwise, and in step once marked", async () => {
    const owner = fakeOwner({}, { revision: "r7" });
    expect(seenRevision("samples")).toBe("");
    expect(await isStale(owner, "samples")).toBe(true);
    markSynced("samples", "r7");
    expect(await isStale(owner, "samples")).toBe(false);
  });

  it("goes stale again when the owner moves", async () => {
    markSynced("samples", "r7");
    expect(await isStale(fakeOwner({}, { revision: "r8" }), "samples")).toBe(
      true,
    );
  });
});
