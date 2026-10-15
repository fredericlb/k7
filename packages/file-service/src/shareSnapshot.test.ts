// shareSnapshot.test.ts — a checkpoint made into a share: what of the workspace it asks the history for, and that the
// share it builds plays from its OWN folder — no path of the server's temp folder or of the live project left in.
// See docs/share.md.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { scaffold } from "@studio/song/scaffold";
import type { CheckpointFiles } from "@studio/web-protocol";
import { SHARE_ROOT, SHARE_SCHEMA } from "@studio/web-protocol";
import { afterAll, describe, expect, it } from "vitest";
import { buildShareSnapshot, checkpointPrefixes } from "./shareSnapshot.ts";

const cleanups: (() => void)[] = [];
afterAll(() => {
  for (const c of cleanups) c();
});

describe("what a project reads of its workspace", () => {
  it("is its folder, the playlists, and the shared files of every folder above it", () => {
    const p = checkpointPrefixes("albums/winter.k7");
    expect(p).toContain("albums/winter.k7");
    expect(p).toContain("_playlists");
    expect(p).toContain("albums/_modules");
    expect(p).toContain("_modules");
    expect(p).toContain("albums/_library-pins.yaml");
    expect(p).toContain("_library-pins.yaml");
    // Never a sibling project.
    expect(p.some((x) => x.startsWith("albums/summer"))).toBe(false);
  });
});

/** Every file under `dir` as a checkpoint's texts, and `blobs` as files whose bytes sit elsewhere on the disk. */
function checkpointOf(
  dir: string,
  blobs: Record<string, string>,
): CheckpointFiles {
  const texts: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else
        texts[relative(dir, abs).split(sep).join("/")] = readFileSync(
          abs,
          "utf8",
        );
    }
  };
  walk(dir);
  return {
    seq: 3,
    texts,
    blobs: Object.fromEntries(
      Object.entries(blobs).map(([rel, path]) => [
        rel,
        { path, size: statSync(path).size },
      ]),
    ),
  };
}

describe("building a share from a checkpoint", () => {
  it("compiles the checkpoint's copy and names every one of its files under the share's own folder", () => {
    process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "share-home-"));
    const ws = mkdtempSync(join(tmpdir(), "share-ws-"));
    const project = join(ws, "songs", "danse.k7");
    mkdirSync(project, { recursive: true });
    scaffold(project, "danse");
    const bytes = join(mkdtempSync(join(tmpdir(), "share-blob-")), "x");
    writeFileSync(bytes, "RIFF....WAVE");
    const snap = buildShareSnapshot(
      checkpointOf(ws, { "songs/danse.k7/clips/take.wav": bytes }),
      { workspace: "band", seq: 3, name: "share: danse.k7" },
      "songs/danse.k7",
    );
    cleanups.push(snap.cleanup);

    expect(snap.manifest.schema).toBe(SHARE_SCHEMA);
    expect(snap.manifest.checkpoint.seq).toBe(3);
    expect(snap.manifest.docs.sort()).toEqual([
      "graph.json",
      "project-doc.json",
      "surfaces.json",
    ]);
    // The checkpoint's binary is carried, from where the history keeps its bytes.
    expect(snap.manifest.files.map((f) => f.path)).toContain(
      "src/songs/danse.k7/clips/take.wav",
    );
    const engine = readFileSync(join(snap.dir, "engine-doc.json"), "utf8");
    // Nothing of this server's temp folders, or of the live workspace, survives in what the engine is sent.
    expect(engine).not.toContain(snap.dir);
    expect(engine).not.toContain(ws);
    expect(engine).not.toContain(process.env.STUDIO_HOME as string);
    expect(engine).toContain(`${SHARE_ROOT}src/songs/danse.k7`);
  });

  it("refuses a project the checkpoint does not hold", () => {
    expect(() =>
      buildShareSnapshot(
        { seq: 1, texts: {}, blobs: {} },
        { workspace: "band", seq: 1, name: "x" },
        "nope.k7",
      ),
    ).toThrow(/not in the checkpoint/);
  });
});
