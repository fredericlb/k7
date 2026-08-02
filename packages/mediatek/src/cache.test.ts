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
        morceaux: "",
        samples: "",
        modules: opts.revision ?? "r1",
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
  process.env.LANES_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.LANES_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("syncing a family", () => {
  it("fetches everything on a cold cache", async () => {
    const owner = fakeOwner({
      "modules/instruments/synth/module.yaml": {
        body: "plugin: {}\n",
        mtime: 1,
      },
      "modules/instruments/synth/lead.yaml": { body: "params: {}\n", mtime: 2 },
    });
    const r = await syncFamily(owner, "modules");
    expect(r.fetched.length).toBe(2);
    expect(r.failed).toEqual([]);
    expect(read("modules/instruments/synth/module.yaml")).toBe("plugin: {}\n");
  });

  it("fetches nothing the second time", async () => {
    const owner = fakeOwner({ "modules/a.yaml": { body: "a\n", mtime: 1 } });
    await syncFamily(owner, "modules");
    const again = await syncFamily(owner, "modules");
    expect(again.fetched).toEqual([]);
    expect(again.dropped).toEqual([]);
  });

  it("re-fetches a file the owner changed, on mtime alone", async () => {
    // The local copy has its own mtime and its own size may be identical; only the OWNER's
    // description moves, which is exactly what the remembered manifest exists to see.
    const owner = fakeOwner({ "modules/a.yaml": { body: "a\n", mtime: 1 } });
    await syncFamily(owner, "modules");
    const moved = fakeOwner({ "modules/a.yaml": { body: "b\n", mtime: 9 } });
    const r = await syncFamily(moved, "modules");
    expect(r.fetched).toEqual(["modules/a.yaml"]);
    expect(read("modules/a.yaml")).toBe("b\n");
  });

  it("drops what the owner no longer has", async () => {
    const owner = fakeOwner({
      "modules/a.yaml": { body: "a\n", mtime: 1 },
      "modules/b.yaml": { body: "b\n", mtime: 1 },
    });
    await syncFamily(owner, "modules");
    const fewer = fakeOwner({ "modules/a.yaml": { body: "a\n", mtime: 1 } });
    const r = await syncFamily(fewer, "modules");
    expect(r.dropped).toEqual(["modules/b.yaml"]);
    expect(existsSync(join(root, "modules/b.yaml"))).toBe(false);
  });

  it("leaves no half-written file behind when a download fails", async () => {
    // Downloaded to `.part` and renamed, because the moteur may be reading this tree.
    const owner = fakeOwner(
      {
        "modules/ok.yaml": { body: "ok\n", mtime: 1 },
        "modules/bad.yaml": { body: "bad\n", mtime: 1 },
      },
      { failOn: "modules/bad.yaml" },
    );
    const r = await syncFamily(owner, "modules");
    expect(r.fetched).toEqual(["modules/ok.yaml"]);
    expect(r.failed.map((f) => f.path)).toEqual(["modules/bad.yaml"]);
    expect(existsSync(join(root, "modules/bad.yaml"))).toBe(false);
    expect(existsSync(join(root, "modules/bad.yaml.part"))).toBe(false);
  });

  it("remembers only what actually landed, so a failure is retried", async () => {
    const failing = fakeOwner(
      {
        "modules/ok.yaml": { body: "ok\n", mtime: 1 },
        "modules/bad.yaml": { body: "bad\n", mtime: 1 },
      },
      { failOn: "modules/bad.yaml" },
    );
    await syncFamily(failing, "modules");
    expect(heldManifest("modules").map((e) => e.path)).toEqual([
      "modules/ok.yaml",
    ]);
    const healed = fakeOwner({
      "modules/ok.yaml": { body: "ok\n", mtime: 1 },
      "modules/bad.yaml": { body: "bad\n", mtime: 1 },
    });
    expect((await syncFamily(healed, "modules")).fetched).toEqual([
      "modules/bad.yaml",
    ]);
  });

  it("keeps its bookkeeping out of the library's own content", async () => {
    // Under .cache/, which both the family walk and the revision token skip — otherwise
    // writing the manifest would invalidate the very token it was written for.
    const owner = fakeOwner({ "modules/a.yaml": { body: "a\n", mtime: 1 } });
    await syncFamily(owner, "modules");
    expect(existsSync(join(root, ".cache", "manifest", "modules.json"))).toBe(
      true,
    );
  });
});

describe("staleness", () => {
  it("is stale until told otherwise, and in step once marked", async () => {
    const owner = fakeOwner({}, { revision: "r7" });
    expect(seenRevision("modules")).toBe("");
    expect(await isStale(owner, "modules")).toBe(true);
    markSynced("modules", "r7");
    expect(await isStale(owner, "modules")).toBe(false);
  });

  it("goes stale again when the owner moves", async () => {
    markSynced("modules", "r7");
    expect(await isStale(fakeOwner({}, { revision: "r8" }), "modules")).toBe(
      true,
    );
  });
});
