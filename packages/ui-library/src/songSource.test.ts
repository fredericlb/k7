// songSource.test.ts — where a song is read and written, on the phone and elsewhere.

import { describe, expect, it } from "vitest";
import { songSide } from "./songSource";

describe("songSide", () => {
  it("leaves every song to the pages' library off the phone", () => {
    for (const place of ["synced", "local", "server", null] as const)
      expect(songSide({ place, onDemand: false, reachable: false })).toEqual({
        read: "local",
        write: "local",
      });
  });

  it("keeps a song of this machine alone local, server or not", () => {
    expect(
      songSide({ place: "local", onDemand: true, reachable: false }),
    ).toEqual({ read: "local", write: "local" });
  });

  it("reads and edits a server song on the server while it answers", () => {
    for (const place of ["synced", "server"] as const)
      expect(songSide({ place, onDemand: true, reachable: true })).toEqual({
        read: "server",
        write: "server",
      });
  });

  it("makes a copied song read-only while the server is away", () => {
    expect(
      songSide({ place: "synced", onDemand: true, reachable: false }),
    ).toEqual({ read: "local", write: null });
  });

  it("cannot open a server song with no copy while the server is away", () => {
    expect(
      songSide({ place: "server", onDemand: true, reachable: false }),
    ).toEqual({ read: null, write: null });
  });

  it("reads the copy and still edits on the server before the backend has said", () => {
    expect(
      songSide({ place: "synced", onDemand: true, reachable: null }),
    ).toEqual({ read: "local", write: "server" });
  });
});
