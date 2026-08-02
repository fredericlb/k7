import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uploadWorkspace } from "./ingest.ts";
import type { LibrarySink } from "./remote.ts";

// A sink with no server. The push is written against the port, so what a test checks is
// what was SENT — which is the whole contract; where it lands is the owner's business.
function fakeSink(opts: { failOn?: string } = {}) {
  const put = new Map<string, string>();
  const removed: string[] = [];
  const sink: LibrarySink = {
    put: async (path, body) => {
      if (path === opts.failOn) throw new Error("boom");
      put.set(
        path,
        typeof body === "string" ? body : Buffer.from(body).toString("utf8"),
      );
    },
    remove: async (path) => {
      removed.push(path);
    },
  };
  return { sink, put, removed };
}

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "mediatek-ws-"));
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

const w = (rel: string, body = "x"): void => {
  const abs = join(ws, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
};

// The namespace in `_modules/config.yaml` is what every module ref is keyed by. Uploading
// it made the LAST workspace pushed rename the whole library — silently, for every project
// inheriting from it. It is the library's own now (see layout.ts).
describe("what the library keeps for itself", () => {
  it("refuses to send a workspace's modules/config.yaml", async () => {
    w("_modules/config.yaml", "namespace: someone-elses\n");
    w("_modules/audio/reverb/module.yaml", "plugin: {}\n");
    const { sink, put } = fakeSink();
    const r = await uploadWorkspace(sink, ws);
    expect(put.has("modules/config.yaml")).toBe(false);
    expect(r.uploaded).toEqual(["modules/audio/reverb/module.yaml"]);
  });

  it("says so, rather than dropping it quietly", () => {
    // "it uploaded" and "it uploaded everything" are different claims, and a caller
    // wondering where its config went deserves the answer in the report.
    w("_modules/config.yaml", "namespace: someone-elses\n");
    return uploadWorkspace(fakeSink().sink, ws).then((r) => {
      expect(r.skipped).toHaveLength(1);
      expect(r.skipped[0].path).toBe("modules/config.yaml");
      expect(r.skipped[0].reason).toMatch(/namespace/);
    });
  });

  it("still sends a config.yaml that is not the modules root's", async () => {
    // Only the ONE path is the library's. A module of its own named config.yaml, or one in
    // `_library`, is ordinary content — a blanket filename rule would have eaten those.
    w("_modules/audio/reverb/config.yaml", "gain: 3\n");
    w("_library/config.yaml", "x");
    const r = await uploadWorkspace(fakeSink().sink, ws);
    expect(r.skipped).toEqual([]);
    expect(r.uploaded.sort()).toEqual([
      "library/config.yaml",
      "modules/audio/reverb/config.yaml",
    ]);
  });
});

describe("pushing a workspace's shared folders up", () => {
  it("maps each workspace folder onto its library name", () => {
    w("_modules/audio/reverb/module.yaml", "plugin: {}\n");
    w("_library/ir/hall.wav", "RIFF");
    w("_ui/audio/reverb.yaml", "ref: audio/reverb\n");
    return uploadWorkspace(fakeSink().sink, ws).then((r) => {
      expect(r.uploaded.sort()).toEqual([
        "library/ir/hall.wav",
        "modules/audio/reverb/module.yaml",
        "ui/audio/reverb.yaml",
      ]);
      expect(r.failed).toEqual([]);
    });
  });

  it("sends the file's actual contents", async () => {
    w("_modules/a/module.yaml", "plugin: {name: Big}\n");
    const { sink, put } = fakeSink();
    await uploadWorkspace(sink, ws);
    expect(put.get("modules/a/module.yaml")).toBe("plugin: {name: Big}\n");
  });

  it("keeps the tree's shape below the folder", async () => {
    w("_modules/instruments/synth/presets/lead.vstpreset", "p");
    const { sink, put } = fakeSink();
    await uploadWorkspace(sink, ws);
    expect([...put.keys()]).toEqual([
      "modules/instruments/synth/presets/lead.vstpreset",
    ]);
  });

  it("reports a folder the workspace hasn't got, rather than failing", async () => {
    w("_modules/a/module.yaml", "plugin: {}\n");
    const r = await uploadWorkspace(fakeSink().sink, ws);
    expect(r.absent.sort()).toEqual(["_library", "_ui"]);
  });

  it("carries on past a file that fails, and says which", async () => {
    // A partial push is a real outcome: one refused file must not lose the rest.
    w("_modules/ok/module.yaml", "a\n");
    w("_modules/bad/module.yaml", "b\n");
    const r = await uploadWorkspace(
      fakeSink({ failOn: "modules/bad/module.yaml" }).sink,
      ws,
    );
    expect(r.uploaded).toEqual(["modules/ok/module.yaml"]);
    expect(r.failed.map((f) => f.path)).toEqual(["modules/bad/module.yaml"]);
  });

  it("skips the per-machine junk a workspace accumulates", async () => {
    w("_modules/.DS_Store");
    w("_modules/a/module.yaml", "plugin: {}\n");
    const r = await uploadWorkspace(fakeSink().sink, ws);
    expect(r.uploaded).toEqual(["modules/a/module.yaml"]);
  });
});
