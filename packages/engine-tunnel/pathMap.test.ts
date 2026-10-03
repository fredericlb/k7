// pathMap.test.ts — what a synced channel and a `sync` request owe the engine: a frame is only
// rewritten, never held for a download, and the copy happens once, up front, reporting as it goes.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TargetInUse } from "./agentFiles.ts";
import type { RemoteStat } from "./frames.ts";
import {
  PathMap,
  type RemoteFiles,
  SyncLedger,
  type SyncProgress,
} from "./pathMap.ts";

const REMOTE = "/srv/ws";
const server: Record<string, string> = {
  [`${REMOTE}/song/kick.wav`]: "RIFF-kick",
  [`${REMOTE}/song/snare.wav`]: "RIFF-snare!",
};

function fakeServer(): {
  files: RemoteFiles;
  stats: string[][];
  downloads: string[];
} {
  const stats: string[][] = [];
  const downloads: string[] = [];
  const files: RemoteFiles = {
    async stat(paths) {
      stats.push(paths);
      return paths.map((path): RemoteStat => {
        const body = server[path];
        return body === undefined
          ? { path, kind: "missing" }
          : {
              path,
              kind: "file",
              size: body.length,
              mtimeMs: 1_700_000_000_000,
            };
      });
    },
    async download(e, local) {
      downloads.push(e.path);
      writeFileSync(local, server[e.path]);
      const t = (e.mtimeMs ?? 0) / 1000;
      utimesSync(local, t, t);
    },
    async upload() {
      throw new Error("not in this test");
    },
  };
  return { files, stats, downloads };
}

function mapFor(files: RemoteFiles): { map: PathMap; cache: string } {
  const cache = mkdtempSync(join(tmpdir(), "pathmap-"));
  const map = new PathMap(
    [{ remote: REMOTE, local: cache, writable: true }],
    files,
    new SyncLedger(),
  );
  return { map, cache };
}

describe("PathMap on a synced channel", () => {
  it("rewrites a project frame without asking the server anything", async () => {
    const s = fakeServer();
    const { map, cache } = mapFor(s.files);
    const out = JSON.parse(
      await map.outbound(
        JSON.stringify({ type: "project", clip: `${REMOTE}/song/kick.wav` }),
        false,
      ),
    );
    expect(out.clip).toBe(join(cache, "song", "kick.wav"));
    expect(s.stats).toEqual([]);
    expect(s.downloads).toEqual([]);
  });

  it("leaves a sync request's files for the request to copy", async () => {
    const s = fakeServer();
    const { map } = mapFor(s.files);
    await map.outbound(
      JSON.stringify({ type: "sync", files: [`${REMOTE}/song/kick.wav`] }),
    );
    expect(s.downloads).toEqual([]);
  });

  it("copies what is missing once, reporting each file, and nothing the second time", async () => {
    const s = fakeServer();
    const { map, cache } = mapFor(s.files);
    const locals = [
      join(cache, "song", "kick.wav"),
      join(cache, "song", "snare.wav"),
      join(cache, "song", "clips", "take.wav"),
    ];
    const seen: SyncProgress[] = [];
    expect((await map.sync(locals, (p) => seen.push(p))).failures).toEqual([]);
    expect(s.downloads.sort()).toEqual([
      `${REMOTE}/song/kick.wav`,
      `${REMOTE}/song/snare.wav`,
    ]);
    expect(seen[0]).toEqual({
      files: 2,
      filesDone: 0,
      bytes: 20,
      bytesDone: 0,
      failures: [],
    });
    expect(seen.at(-1)).toEqual({
      files: 2,
      filesDone: 2,
      bytes: 20,
      bytesDone: 20,
      failures: [],
    });
    expect(readFileSync(locals[1], "utf8")).toBe("RIFF-snare!");

    const again: SyncProgress[] = [];
    await map.sync(locals, (p) => again.push(p));
    expect(s.downloads).toHaveLength(2);
    expect(again).toEqual([
      { files: 0, filesDone: 0, bytes: 0, bytesDone: 0, failures: [] },
    ]);
  });

  it("puts a new version beside a file the engine holds, and names that one from then on", async () => {
    const s = fakeServer();
    const { map, cache } = mapFor(s.files);
    const kick = join(cache, "song", "kick.wav");
    mkdirSync(join(cache, "song"));
    expect((await map.sync([kick], () => {})).failures).toEqual([]);
    // The server's copy changes while the engine holds the old one: the replace is refused.
    server[`${REMOTE}/song/kick.wav`] = "RIFF-kick-v2";
    const held = s.files.download;
    s.files.download = async (e, local) => {
      const part = `${local}.part-held`;
      writeFileSync(part, server[e.path]);
      throw new TargetInUse(`${local} is in use`, part);
    };
    const stat0 = s.files.stat;
    s.files.stat = async (paths) =>
      (await stat0(paths)).map((x) => ({ ...x, mtimeMs: 1_700_000_100_000 }));
    const last = await map.sync([kick], () => {});
    expect(last.failures).toEqual([]);
    const aside = join(cache, "song", "kick~1700000100000.wav");
    expect(readFileSync(aside, "utf8")).toBe("RIFF-kick-v2");
    expect(readFileSync(kick, "utf8")).toBe("RIFF-kick");
    const out = JSON.parse(
      await map.outbound(
        JSON.stringify({ type: "project", clip: `${REMOTE}/song/kick.wav` }),
        false,
      ),
    );
    expect(out.clip).toBe(aside);
    expect(map.toRemote(aside)?.remote).toBe(`${REMOTE}/song/kick.wav`);
    s.files.download = held;
    server[`${REMOTE}/song/kick.wav`] = "RIFF-kick";
  });
});
