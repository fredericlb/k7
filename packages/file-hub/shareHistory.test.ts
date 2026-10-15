// shareHistory.test.ts — what a file service is given to make a share: a checkpoint only at a point the server has
// ordered, and the files AT that point, a binary as the path of its bytes — never the files as they are now.
// See packages/file-service/docs/share.md.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blobRef } from "@studio/live-sync/blob";
import type { Sequenced } from "@studio/live-sync/ops";
import { describe, expect, it } from "vitest";
import { blobFile, blobsDir } from "./blobStore.ts";
import { ENTRIES, readCheckpoints } from "./historyLog.ts";
import {
  ShareHistoryError,
  shareCheckpoint,
  shareFilesAt,
} from "./shareHistory.ts";
import { roomDir } from "./syncRelay.ts";

const HASH = "ab".repeat(32);

/** An account whose room `band` holds three entries: a song written, a clip uploaded, the song edited again. */
function account(withBytes = true): string {
  const acct = mkdtempSync(join(tmpdir(), "share-hist-"));
  const room = roomDir(acct, "band");
  mkdirSync(room, { recursive: true });
  const entry = (seq: number, file: string, text: string): Sequenced => ({
    seq,
    batch: {
      id: `b${seq}`,
      replica: "laptop",
      local: seq,
      ts: seq,
      label: "edit",
      ops: [{ kind: "text", file, text, was: null }],
    },
    parked: [],
  });
  writeFileSync(
    join(room, ENTRIES),
    [
      entry(1, "danse.k7/project.yaml", "name: v1\n"),
      entry(2, "danse.k7/clips/take.wav", blobRef(HASH, 12)),
      entry(3, "danse.k7/project.yaml", "name: v2\n"),
      entry(4, "other.k7/project.yaml", "name: other\n"),
    ]
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
  if (withBytes) {
    const at = blobFile(blobsDir(acct), HASH);
    mkdirSync(join(at, ".."), { recursive: true });
    writeFileSync(at, "RIFF....WAVE");
  }
  return acct;
}

describe("a share's checkpoint", () => {
  it("is named at a point the server holds", () => {
    const acct = account();
    shareCheckpoint(acct, null, "band", 2, "share: danse.k7", "a@x.test");
    expect(readCheckpoints(roomDir(acct, "band"))).toMatchObject([
      { seq: 2, name: "share: danse.k7", by: "a@x.test" },
    ]);
  });

  it("is refused past what the server has ordered: the share would lack edits", () => {
    const acct = account();
    expect(() =>
      shareCheckpoint(acct, null, "band", 9, "share", "a@x.test"),
    ).toThrow(ShareHistoryError);
  });

  it("is refused for a workspace with no history here, and for a name that climbs", () => {
    const acct = account();
    expect(() => shareCheckpoint(acct, null, "nope", 1, "s", "a")).toThrow(
      /no history/,
    );
    expect(() => shareCheckpoint(acct, null, "../x", 1, "s", "a")).toThrow(
      /not a workspace name/,
    );
  });
});

describe("the files at a checkpoint", () => {
  it("are the point's, not the latest, and only under the prefixes asked", () => {
    const acct = account();
    const f = shareFilesAt(acct, "band", 2, ["danse.k7"]);
    expect(f.texts).toEqual({ "danse.k7/project.yaml": "name: v1\n" });
    expect(f.blobs["danse.k7/clips/take.wav"]).toEqual({
      path: blobFile(blobsDir(acct), HASH),
      size: 12,
    });
    expect(shareFilesAt(acct, "band", 4, ["danse.k7"]).texts).toEqual({
      "danse.k7/project.yaml": "name: v2\n",
    });
  });

  it("refuse a binary whose bytes never reached the server", () => {
    const acct = account(false);
    expect(() => shareFilesAt(acct, "band", 2, ["danse.k7"])).toThrow(
      /not finished uploading/,
    );
  });
});
