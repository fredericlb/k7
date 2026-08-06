import { describe, expect, it } from "vitest";
import { projectRows, type Row, rowKey, rowTarget } from "./rows";
import type { WebGroup, WebTrack, WebVideoTrack } from "./types";

// The lane layout, and what each kind of row ADDRESSES — which is what a header click, a
// mute key and a graph lookup all ask it.

const track = (over: Partial<WebTrack> & { id: string }): WebTrack => ({
  name: over.id,
  group: "",
  generated: false,
  contentType: "audio",
  color: "",
  mute: false,
  solo: false,
  clips: [],
  plugins: [],
  ...over,
});
const group = (id: string): WebGroup => ({
  id,
  name: id,
  color: "",
  mute: false,
  solo: false,
});
const videoTrack = (id: string): WebVideoTrack => ({
  id,
  name: id,
  kind: "video",
  color: "",
  mute: false,
  x: 0,
  y: 0,
  w: 1920,
  h: 1080,
  clips: [],
  shapes: [],
});

describe("projectRows", () => {
  it("nests a group's members under a header placed where the first sits", () => {
    const rows = projectRows({ groups: [group("drums")] }, [
      track({ id: "bass" }),
      track({ id: "kick", group: "drums" }),
      track({ id: "snare", group: "drums" }),
    ]);
    expect(rows.map(rowKey)).toEqual([
      "track:bass",
      "group:drums",
      "track:kick",
      "track:snare",
    ]);
  });

  it("draws a track whose group does not exist as a plain lane", () => {
    // The surfaces show what the song HAS, not what it should: a dangling pointer is
    // something to see, not something to hide behind a header that isn't there.
    const rows = projectRows({ groups: [] }, [
      track({ id: "kick", group: "gone" }),
    ]);
    expect(rows.map(rowKey)).toEqual(["track:kick"]);
  });
});

describe("rowTarget", () => {
  it("names the track behind a lane", () => {
    const row: Row = {
      kind: "track",
      track: track({ id: "ge.lead" }),
      index: 0,
      grouped: false,
    };
    expect(rowTarget(row)).toEqual({ kind: "track", id: "ge.lead" });
  });

  it("names the group behind a header", () => {
    expect(rowTarget({ kind: "group", group: group("drums") })).toEqual({
      kind: "group",
      id: "drums",
    });
  });

  it("redirects a generated lane to its GROUP", () => {
    // The lane is synthesized per tick: no file to open, no chain of its own to frame. Its
    // group has both — the same redirect m/s make (docs/timeline.md).
    const row: Row = {
      kind: "track",
      track: track({ id: "algo1", group: "beats", generated: true }),
      index: 0,
      grouped: true,
    };
    expect(rowTarget(row)).toEqual({ kind: "group", id: "beats" });
  });

  it("has nothing to point at for a generated lane in no group", () => {
    const row: Row = {
      kind: "track",
      track: track({ id: "algo1", generated: true }),
      index: 0,
      grouped: false,
    };
    expect(rowTarget(row)).toBeNull();
  });

  it("keeps a video lane apart from an engine track", () => {
    // It has a file, so a header click can still open it — but it is no track, and the
    // callers that ask for a mixer command or a chain have to be able to tell.
    expect(rowTarget({ kind: "video", track: videoTrack("cam1") })).toEqual({
      kind: "video",
      id: "cam1",
    });
  });
});
