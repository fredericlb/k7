// liveSyncReady.test.ts — when a project may be opened on a machine that syncs: its text the room's and
// every file it names on disk, or the relay away and nothing missing. See docs/liveCapture.md, "Up to date".

import { describe, expect, it } from "vitest";
import { pendingUnder, syncStateOf } from "./liveSync.ts";

describe("syncStateOf", () => {
  it("opens a project whose text is current and whose files are all here", () => {
    expect(syncStateOf("current", 0)).toEqual({
      state: "ready",
      ready: true,
      pending: 0,
    });
  });

  it("holds one whose text is still arriving, or not yet asked for", () => {
    expect(syncStateOf("connecting", 0).ready).toBe(false);
    expect(syncStateOf("catching-up", 0)).toMatchObject({
      state: "catching-up",
      ready: false,
    });
  });

  it("holds one whose text is current while files are still downloading", () => {
    expect(syncStateOf("current", 3)).toEqual({
      state: "downloading",
      ready: false,
      pending: 3,
    });
  });

  it("opens offline with what is here — unless a file it names never arrived", () => {
    expect(syncStateOf("offline", 0)).toMatchObject({ ready: true });
    expect(syncStateOf("offline", 2)).toEqual({
      state: "offline",
      ready: false,
      pending: 2,
    });
  });

  it("never opens one the relay refused, and says which side to update", () => {
    expect(syncStateOf("refused", 0, "server-older")).toEqual({
      state: "refused",
      ready: false,
      pending: 0,
      refused: "server-older",
    });
  });
});

describe("pendingUnder", () => {
  const files = [
    "01.danse.k7/clips/vox.wav",
    "01.danse.k7-copy/clips/a.wav",
    "02.elle.k7/clips/b.wav",
  ];

  it("counts the project's own files, not a sibling whose name starts the same", () => {
    expect(pendingUnder(files, "01.danse.k7")).toBe(1);
  });

  it("counts the whole workspace for the empty path", () => {
    expect(pendingUnder(files, "")).toBe(3);
  });
});
