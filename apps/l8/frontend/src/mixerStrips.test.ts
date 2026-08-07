import { describe, expect, it } from "vitest";
import { mixerModules } from "./mixerStrips";
import type { WebProject, WebTrack } from "./types";

// Which strips the Mixer panel draws, and in what order. The compiled project is the only thing
// that knows a track's mixer module, so this is the whole of the panel's decision.

const track = (id: string, mixer?: string): WebTrack =>
  ({
    id,
    name: id,
    ...(mixer
      ? { mixer: { module: mixer, volume: 0, pan: 0, low: 0, mid: 0, high: 0 } }
      : {}),
  }) as unknown as WebTrack;

const proj = (tracks: WebTrack[]): WebProject =>
  ({ tracks }) as unknown as WebProject;

describe("mixerModules", () => {
  it("keeps the song's track order", () => {
    expect(
      mixerModules(proj([track("vox", "mx-vox"), track("bass", "mx-bass")])),
    ).toEqual(["mx-vox", "mx-bass"]);
  });

  it("skips a track with no mixer rather than drawing a dead strip", () => {
    // Not "at unity" — a track with nowhere to put a level. A strip for it would say something
    // the song does not.
    expect(
      mixerModules(
        proj([track("vox", "mx-vox"), track("fx"), track("bass", "mx-bass")]),
      ),
    ).toEqual(["mx-vox", "mx-bass"]);
  });

  it("draws a shared strip ONCE, where the first track using it puts it", () => {
    // Two tracks may end on the same bus strip. It is one card: two would offer two controls
    // for one value.
    expect(
      mixerModules(
        proj([
          track("vox", "mx-bus"),
          track("bass", "mx-bass"),
          track("gtr", "mx-bus"),
        ]),
      ),
    ).toEqual(["mx-bus", "mx-bass"]);
  });

  it("has nothing to draw before the project has loaded, or with no tracks", () => {
    expect(mixerModules(null)).toEqual([]);
    expect(mixerModules(proj([]))).toEqual([]);
  });
});
