import { describe, expect, it } from "vitest";
import { baseName, localPathFor } from "./sftp.ts";
import { flattenTransfers } from "./slskd.ts";

describe("localPathFor", () => {
  it("rebuilds the layout slskd documents: the containing folder and the name", () => {
    expect(
      localPathFor(
        "@bob\\Music\\Nirvana\\Nevermind\\05 Lithium.flac",
        "/downloads",
      ),
    ).toBe("/downloads/Nevermind/05 Lithium.flac");
  });

  it("takes forward slashes too, since not every peer runs Windows", () => {
    expect(localPathFor("@ann/music/Kind of Blue/So What.flac", "/dl/")).toBe(
      "/dl/Kind of Blue/So What.flac",
    );
  });

  it("cannot be walked out of the downloads directory", () => {
    // This string comes off the Soulseek network, where a file name is whatever a stranger
    // typed — slskd's own docs warn that these values are hostile.
    for (const nasty of [
      "@u\\..\\..\\etc\\passwd",
      "../../../../etc/shadow",
      "@u\\.\\.\\.ssh\\id_rsa",
    ]) {
      const out = localPathFor(nasty, "/downloads");
      expect(out.startsWith("/downloads/")).toBe(true);
      expect(out).not.toContain("..");
    }
  });

  it("still yields a path for a bare file name", () => {
    expect(localPathFor("song.mp3", "/downloads")).toBe("/downloads/song.mp3");
  });
});

describe("baseName", () => {
  it("is the file's own name, whichever separator was used", () => {
    expect(baseName("@bob\\Music\\Nevermind\\05 Lithium.flac")).toBe(
      "05 Lithium.flac",
    );
    expect(baseName("a/b/c.mp3")).toBe("c.mp3");
  });
});

describe("flattenTransfers", () => {
  it("digs the transfers out of the nesting slskd wraps them in", () => {
    const body = {
      username: "bob",
      directories: [
        {
          directory: "Nevermind",
          files: [
            {
              id: "abc",
              filename: "@bob\\Nevermind\\Lithium.flac",
              state: "InProgress",
              size: 40,
              bytesTransferred: 10,
            },
          ],
        },
      ],
    };
    expect(flattenTransfers(body)).toEqual([
      {
        id: "abc",
        filename: "@bob\\Nevermind\\Lithium.flac",
        state: "InProgress",
        size: 40,
        bytesTransferred: 10,
        percentComplete: undefined,
      },
    ]);
  });

  it("takes a bare list as readily as a nested one", () => {
    // The nesting is slskd's to change, and a client that hard-coded one path through it
    // would report "no transfers" — which reads exactly like one that never started, and
    // would burn all ten switches for nothing.
    expect(
      flattenTransfers([{ id: "x", filename: "a.mp3", state: "Queued" }]),
    ).toHaveLength(1);
  });

  it("is empty rather than throwing on something unexpected", () => {
    expect(flattenTransfers(null)).toEqual([]);
    expect(flattenTransfers({ nothing: "here" })).toEqual([]);
    expect(flattenTransfers("a string")).toEqual([]);
  });
});
