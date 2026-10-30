import { describe, expect, it } from "vitest";
import { capturedAt, isCapturePath, isMomentClip } from "./recordingName.ts";

describe("a capture's name", () => {
  it("reads the local time it was filed under", () => {
    expect(capturedAt("recordings/2026-08-03/21-05-07.webm")).toEqual(
      new Date(2026, 7, 3, 21, 5, 7),
    );
    expect(capturedAt("recordings/2026-08-03/21-05-07-2.mp3")).toEqual(
      new Date(2026, 7, 3, 21, 5, 7),
    );
  });

  it("has no time when the zone did not name it", () => {
    expect(capturedAt("recordings/2026-08-03/take.mp3")).toBeNull();
    expect(capturedAt("songs/a/b/c/original.mp3")).toBeNull();
  });

  it("is a capture only inside a day folder, and never a moment's clip", () => {
    expect(isCapturePath("recordings/2026-08-03/21-05-07.webm")).toBe(true);
    expect(isCapturePath("recordings/2026-08-03/take.mp3")).toBe(true);
    expect(
      isCapturePath("recordings/2026-08-03/moment-21-05-07--15--Solo.webm"),
    ).toBe(false);
    expect(isCapturePath("recordings/../songs/x.mp3")).toBe(false);
    expect(isCapturePath("songs/a/b.mp3")).toBe(false);
    expect(isCapturePath("recordings/21-05-07.webm")).toBe(false);
    expect(isMomentClip("moment-21-05-07--15.webm")).toBe(true);
  });
});
