import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changedFiles,
  dropSynced,
  readSynced,
  rowsUnder,
  songsToRefresh,
  writeSynced,
} from "./synced.ts";

const row = (path: string, bytes = 1, mtime = 1) => ({ path, bytes, mtime });

describe("the synced sidecar", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mediatek-synced-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads back what was written, and nothing once dropped", () => {
    const s = { server: "https://a.b", rev: "7", files: [row("songs/x/a")] };
    writeSynced(dir, s);
    expect(readSynced(dir)).toEqual(s);
    // No temporary left beside it.
    expect(readdirSync(dir)).toEqual([".synced.json"]);
    dropSynced(dir);
    expect(readSynced(dir)).toBeNull();
  });

  it("reads a missing sidecar as none", () => {
    expect(readSynced(join(dir, "nope"))).toBeNull();
  });
});

describe("what a refresh does", () => {
  it("takes only a song's own rows, not a sibling's sharing its prefix", () => {
    const m = [row("songs/a/b"), row("songs/a/b/x"), row("songs/a/bc/x")];
    expect(rowsUnder(m, "songs/a/b").map((r) => r.path)).toEqual([
      "songs/a/b",
      "songs/a/b/x",
    ]);
  });

  it("fetches what is new or changed and drops what the server removed", () => {
    const before = [row("s/a", 1, 1), row("s/b", 1, 1), row("s/c", 1, 1)];
    const server = [row("s/a", 1, 1), row("s/b", 2, 1), row("s/d", 1, 1)];
    const d = changedFiles(server, before);
    expect(d.fetch.map((f) => f.path)).toEqual(["s/b", "s/d"]);
    expect(d.drop).toEqual(["s/c"]);
  });

  it("names the changed songs and the ones the server no longer has", () => {
    const synced = (files: ReturnType<typeof row>[]) => ({
      server: "https://a.b",
      rev: "1",
      files,
    });
    const server = [row("songs/same/m", 1, 1), row("songs/edited/m", 1, 2)];
    expect(
      songsToRefresh(server, [
        { path: "songs/same", synced: synced([row("songs/same/m", 1, 1)]) },
        { path: "songs/edited", synced: synced([row("songs/edited/m", 1, 1)]) },
        { path: "songs/gone", synced: synced([row("songs/gone/m", 1, 1)]) },
      ]),
    ).toEqual({ changed: ["songs/edited"], gone: ["songs/gone"] });
  });
});
