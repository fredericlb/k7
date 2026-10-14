// liveSync.test.ts — on by default, a write through the Workspace lands in the log under its label.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachLiveCapture,
  detachLiveCapture,
  liveLogTail,
} from "./liveSync.ts";
import { Workspace } from "./workspace.ts";

const roots: string[] = [];
const PINNED_HOME = process.env.STUDIO_HOME;
afterEach(() => {
  for (const r of roots.splice(0)) detachLiveCapture(r);
  delete process.env.STUDIO_LIVE_SYNC;
  process.env.STUDIO_HOME = PINNED_HOME;
});

function workspace(): Workspace {
  process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "live-home-"));
  const root = mkdtempSync(join(tmpdir(), "live-ws-"));
  mkdirSync(join(root, "song.k7"), { recursive: true });
  writeFileSync(join(root, "song.k7", "song.yaml"), "tempo: 120\n");
  const ws = new Workspace(root);
  roots.push(ws.root);
  return ws;
}

async function until<T>(f: () => T | null | undefined, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("live sync in the file service", () => {
  it("is off with STUDIO_LIVE_SYNC=0", () => {
    process.env.STUDIO_LIVE_SYNC = "0";
    const ws = workspace();
    attachLiveCapture(ws, "band");
    expect(ws.liveCapture).toBeNull();
    expect(liveLogTail(ws, 10)).toBeNull();
  });

  it("logs a write made inside recordChange under the window's label", async () => {
    const ws = workspace();
    attachLiveCapture(ws, "band");
    await ws.recordChange("édition song.k7/song.yaml", () =>
      ws.write("song.k7/song.yaml", "tempo: 128\n"),
    );
    const [batch] = await until(() => {
      const t = liveLogTail(ws, 10);
      return t?.length ? t : null;
    });
    expect(batch.label).toBe("édition song.k7/song.yaml");
    expect(batch.ops).toEqual([
      {
        kind: "yaml",
        file: "song.k7/song.yaml",
        ops: [{ op: "set", path: ["tempo"], yaml: "128\n", was: "120\n" }],
      },
    ]);
  });
});
