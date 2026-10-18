// A clip's copies and a still reach the picture document as the scene reads them: absolute paths
// for the optimized copy and the proxy, and `still` on an image, which takes no decoder.

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { videoPlacementToClip } from "./videoTracks";

describe("a picture clip's files in the document", () => {
  it("carries the optimized copy and the proxy, resolved like the source", () => {
    const shot = videoPlacementToClip(
      "/p",
      { ref: "a", start: 0, length: 2 },
      {
        a: {
          source: "clips/a.mov",
          optimized: "clips/a.optimized.mp4",
          proxy: "clips/a.proxy.mp4",
        },
      },
    );
    // Resolved as the code resolves them, which on Windows puts a drive in front.
    expect(shot).toMatchObject({
      source: resolve("/p/clips/a.mov"),
      optimized: resolve("/p/clips/a.optimized.mp4"),
      proxy: resolve("/p/clips/a.proxy.mp4"),
    });
    expect(shot.still).toBeUndefined();
  });

  it("marks an image as a still", () => {
    const shot = videoPlacementToClip(
      "/p",
      { ref: "photo", start: 0, length: 5 },
      { photo: { source: "clips/photo.JPG" } },
    );
    expect(shot.still).toBe(true);
  });
});
