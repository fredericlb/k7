// takes.test.ts — what the tab strip promises: the master leads, the sidecar's order is
// kept, and only a version that HAS a file claims one.

import { describe, expect, it } from "vitest";
import { ORIGINAL, takesOf } from "./takes.ts";
import type { MediatekEntry, SongVariant } from "./types.ts";

const song = (
  master: string | null,
  variants?: SongVariant[],
): MediatekEntry => ({
  family: "songs",
  id: "songs/Miles/So What",
  name: "So What",
  path: "songs/Miles/So What",
  kind: "",
  mtime: 0,
  ...(variants ? { variants } : {}),
  meta: master ? { master } : {},
});

describe("takesOf", () => {
  it("puts the master first, whatever the sidecar declares", () => {
    const takes = takesOf(
      song("so-what.wav", [
        { name: "instrumental", ref: "instrumental.wav", kind: "file" },
        { name: "sans-voix", ref: "blindtest/vocal-strip", kind: "missing" },
      ]),
    );
    expect(takes.map((t) => t.name)).toEqual([
      ORIGINAL,
      "instrumental",
      "sans-voix",
    ]);
    expect(takes[0]).toEqual({
      name: ORIGINAL,
      kind: "master",
      file: "so-what.wav",
    });
  });

  // A file variant names its bytes; anything else names something the folder has not got.
  it("gives a file variant its file and a chain variant none", () => {
    const [, file, chain] = takesOf(
      song("so-what.wav", [
        { name: "instrumental", ref: "instrumental.wav", kind: "file" },
        { name: "sans-voix", ref: "blindtest/vocal-strip", kind: "missing" },
      ]),
    );
    expect(file.file).toBe("instrumental.wav");
    expect(chain.file).toBeNull();
  });

  // A folder with a sidecar and no audio is allowed, and its tab is drawn so the pane can say so.
  it("keeps the master's tab when there is no master", () => {
    const [only] = takesOf(song(null));
    expect(only).toEqual({ name: ORIGINAL, kind: "master", file: null });
  });

  it("is just the master when nothing else is declared", () => {
    expect(takesOf(song("so-what.wav"))).toHaveLength(1);
  });
});
// `describe("renderNames")` stood here; nothing bounces any more, so there is nothing to name.
