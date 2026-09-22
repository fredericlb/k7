// A page plays its chosen version, unless that version is gone or hidden.

import { describe, expect, it } from "vitest";
import { pageVersion } from "./pageVersion.ts";
import type { Release, ReleaseVersion } from "./types.ts";

const version = (id: string, hidden = false): ReleaseVersion => ({
  id,
  name: id,
  isDefault: id === "a",
  hidden,
  audioMime: "audio/mpeg",
  tracks: [],
  createdAt: "",
});

const release = (versions: ReleaseVersion[]): Release => ({
  id: "r",
  title: "T",
  artist: "A",
  releaseDate: null,
  description: "",
  canDownload: false,
  createdAt: "",
  versions,
  defaultVersionId: "a",
});

describe("pageVersion", () => {
  it("plays the default when the page chose nothing", () => {
    const r = release([version("a"), version("b")]);
    expect(pageVersion({ versionIds: {} }, r)?.id).toBe("a");
  });

  it("plays the page's choice", () => {
    const r = release([version("a"), version("b")]);
    expect(pageVersion({ versionIds: { r: "b" } }, r)?.id).toBe("b");
  });

  it("falls back to the default when the choice is hidden", () => {
    const r = release([version("a"), version("b", true)]);
    expect(pageVersion({ versionIds: { r: "b" } }, r)?.id).toBe("a");
  });

  it("falls back to the default when the choice was deleted", () => {
    const r = release([version("a")]);
    expect(pageVersion({ versionIds: { r: "gone" } }, r)?.id).toBe("a");
  });
});
