import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uploadWorkspace } from "./ingest.ts";
import type { LibrarySink } from "./remote.ts";

// A sink with no server: what a test checks is what was SENT, where it lands being the owner's business.
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
    // Never used by an upload; present because the port says so.
    removeTree: async (path) => {
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

describe("pushing a workspace's shared folder up", () => {
  it("maps the workspace folder onto its library name", () => {
    w("_library/ir/hall.wav", "RIFF");
    w("_library/nam/jcm800.nam", "profile");
    return uploadWorkspace(fakeSink().sink, ws).then((r) => {
      expect(r.uploaded.sort()).toEqual([
        "library/ir/hall.wav",
        "library/nam/jcm800.nam",
      ]);
      expect(r.failed).toEqual([]);
    });
  });

  it("sends the file's actual contents", async () => {
    w("_library/ir/hall.wav", "RIFF-and-then-some");
    const { sink, put } = fakeSink();
    await uploadWorkspace(sink, ws);
    expect(put.get("library/ir/hall.wav")).toBe("RIFF-and-then-some");
  });

  it("keeps the tree's shape below the folder", async () => {
    w("_library/nam/amps/marshall/jcm800.nam", "p");
    const { sink, put } = fakeSink();
    await uploadWorkspace(sink, ws);
    expect([...put.keys()]).toEqual(["library/nam/amps/marshall/jcm800.nam"]);
  });

  it("reports a folder the workspace hasn't got, rather than failing", async () => {
    // Nothing written at all, so the one folder it looks for is absent.
    const r = await uploadWorkspace(fakeSink().sink, ws);
    expect(r.absent).toEqual(["_library"]);
  });

  it("carries on past a file that fails, and says which", async () => {
    // A partial push is a real outcome: one refused file must not lose the rest.
    w("_library/ir/ok.wav", "a");
    w("_library/ir/bad.wav", "b");
    const r = await uploadWorkspace(
      fakeSink({ failOn: "library/ir/bad.wav" }).sink,
      ws,
    );
    expect(r.uploaded).toEqual(["library/ir/ok.wav"]);
    expect(r.failed.map((f) => f.path)).toEqual(["library/ir/bad.wav"]);
  });

  it("skips the per-machine junk a workspace accumulates", async () => {
    w("_library/.DS_Store");
    w("_library/ir/hall.wav", "RIFF");
    const r = await uploadWorkspace(fakeSink().sink, ws);
    expect(r.uploaded).toEqual(["library/ir/hall.wav"]);
  });
});
