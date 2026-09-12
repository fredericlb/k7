import { orderPosition, reorderTracks } from "@studio/song-schema/trackKind";
import { describe, expect, it } from "vitest";
import {
  dropLaneOf,
  isCellRow,
  orderableLane,
  pictureRowId,
  projectRows,
  type Row,
  rowKey,
  rowTarget,
} from "./rows";
import type { WebGroup, WebTrack, WebVideoTrack } from "./types";

// The lane layout, and what each kind of row ADDRESSES — what a header click, a mute key and a graph lookup all ask it.

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
  color: "",
  mute: false,
  solo: false,
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
    // The surfaces show what the song HAS, not what it should: a dangling pointer is something to see, not to hide.
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
    // The lane is synthesized per tick: no file to open, no chain of its own — its group has both (docs/timeline.md).
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
    // It has a file, so a header click can open it — but it is no track, and a caller asking for a mixer command must tell.
    expect(rowTarget({ kind: "video", track: videoTrack("cam1") })).toEqual({
      kind: "video",
      id: "cam1",
    });
  });
});

describe("a song that carries picture", () => {
  it("puts the video lanes last, front layer FIRST", () => {
    // `layers:` is bottom-first, so the rows reverse it: a row above another means IN FRONT of it.
    const rows = projectRows(
      { groups: [] },
      [track({ id: "bass" })],
      [videoTrack("main"), videoTrack("pip")], // compiled bottom-first: main is behind pip
    );
    expect(rows.map(rowKey)).toEqual(["track:bass", "video:pip", "video:main"]);
  });

  it("tells a video lane from an audio lane of the same name", () => {
    // A song is one folder, so `main` can be both a track and a layer: the key is prefixed by kind for exactly this.
    const rows = projectRows(
      { groups: [] },
      [track({ id: "main" })],
      [videoTrack("main")],
    );
    expect(rows.map(rowKey)).toEqual(["track:main", "video:main"]);
  });

  it("is the plain row list when the song has no picture", () => {
    // The argument is defaulted, so every caller that predates picture reads unchanged.
    expect(
      projectRows({ groups: [] }, [track({ id: "bass" })]).map(rowKey),
    ).toEqual(["track:bass"]);
  });
});

// A lane's TAKES: rows of their own, under the lane they came off. See packages/song/docs/takes.md.
describe("takes", () => {
  const withTakes = (id: string, n: number, over: Partial<WebTrack> = {}) =>
    track({
      id,
      ...over,
      takes: Array.from({ length: n }, () => ({ clips: [] })),
    });

  it("follows its lane immediately, oldest first", () => {
    const rows = projectRows({ groups: [] }, [
      withTakes("gtr", 2),
      track({ id: "bass" }),
    ]);
    expect(rows.map(rowKey)).toEqual([
      "track:gtr",
      "take:gtr:1",
      "take:gtr:2",
      "track:bass",
    ]);
  });

  it("stays inside its group, under the member it belongs to", () => {
    const rows = projectRows({ groups: [group("drums")] }, [
      withTakes("kick", 1, { group: "drums" }),
      track({ id: "snare", group: "drums" }),
    ]);
    expect(rows.map(rowKey)).toEqual([
      "group:drums",
      "track:kick",
      "take:kick:1",
      "track:snare",
    ]);
  });

  it("numbers from 1 — the number the two `track take …` commands name it by", () => {
    const rows = projectRows({ groups: [] }, [withTakes("gtr", 3)]);
    expect(rows.filter((r) => r.kind === "take").map((r) => r.n)).toEqual([
      1, 2, 3,
    ]);
  });

  it("ADDRESSES nothing — it is not a lane and cannot answer a lane's commands", () => {
    // Everything downstream of rowTarget asks the engine something, and answering with the lane would mute it from a take's header.
    const rows = projectRows({ groups: [] }, [withTakes("gtr", 1)]);
    expect(rowTarget(rows[1] as Row)).toBeNull();
  });

  it("adds no rows to a lane with none", () => {
    expect(
      projectRows({ groups: [] }, [track({ id: "gtr" })]).map(rowKey),
    ).toEqual(["track:gtr"]);
  });
});

describe("an automation row", () => {
  const lane = (param: string) => ({
    track: "gtr",
    module: "osc",
    param,
    curve: `gtr-${param}`,
    points: [{ time: "1:1:1", value: 0.5 }],
  });

  it("sits under its lane and BEFORE its takes", () => {
    // A curve is part of what the lane is playing; a take is what it was. Reading down a lane you meet its sound before its history.
    const gtr = track({
      id: "gtr",
      takes: [{ clips: [] }, { clips: [] }],
    });
    const rows = projectRows({ groups: [] }, [gtr], [], {
      gtr: [lane("Level")],
    });
    expect(rows.map(rowKey)).toEqual([
      "track:gtr",
      "auto:gtr:Level",
      "take:gtr:1",
      "take:gtr:2",
    ]);
  });

  it("is keyed by PARAM — one knob, one curve, so that names it uniquely", () => {
    const rows = projectRows({ groups: [] }, [track({ id: "gtr" })], [], {
      gtr: [lane("Level"), lane("Filter Freq")],
    });
    expect(rows.map(rowKey)).toEqual([
      "track:gtr",
      "auto:gtr:Level",
      "auto:gtr:Filter Freq",
    ]);
  });

  it("ADDRESSES its track, unlike a take", () => {
    // The knob it draws is part of that lane's sound, so muting or opening from its header means the lane.
    const rows = projectRows({ groups: [] }, [track({ id: "gtr" })], [], {
      gtr: [lane("Level")],
    });
    expect(rowTarget(rows[1] as Row)).toEqual({ kind: "track", id: "gtr" });
  });

  it("holds no caret cell — there is no beat to park on and no clip to drag", () => {
    const rows = projectRows({ groups: [] }, [track({ id: "gtr" })], [], {
      gtr: [lane("Level")],
    });
    expect(isCellRow(rows[1] as Row)).toBe(false);
  });

  it("adds nothing to a project that automates nothing", () => {
    expect(
      projectRows({ groups: [] }, [track({ id: "gtr" })]).map(rowKey),
    ).toEqual(["track:gtr"]);
  });
});

// Where a reorder goes wrong silently: which rows are one lane, and which are no lane at all.
describe("reordering by header", () => {
  const rows = projectRows(
    { groups: [group("g")] },
    [
      track({ id: "vo.main" }),
      track({ id: "lead#audio", group: "g" }),
      track({ id: "lead#midi", group: "g" }),
      track({ id: "orbit", generated: true }),
    ],
    [videoTrack("main"), videoTrack("pip")],
  );

  it("says which lane a header drags, and refuses the rows that are not one", () => {
    const by = (key: string) => rows.find((r) => rowKey(r) === key) as Row;
    expect(orderableLane(by("track:lead#midi"))).toEqual({
      family: "track",
      lane: "lead",
    });
    expect(orderableLane(by("video:pip"))).toEqual({
      family: "video",
      lane: "pip",
    });
    // A group has no file of its own to order, and a pattern lane is the scheduler's.
    expect(orderableLane(by("group:g"))).toBeNull();
    expect(orderableLane(by("track:orbit"))).toBeNull();
  });

  it("resolves a drop onto either half of a lane to that lane", () => {
    expect(dropLaneOf(rows, "track:lead#audio", "track")).toBe("lead");
    expect(dropLaneOf(rows, "track:lead#midi", "track")).toBe("lead");
  });

  it("refuses a drop across the two families, which are two lists", () => {
    expect(dropLaneOf(rows, "video:main", "track")).toBeNull();
    expect(dropLaneOf(rows, "track:vo.main", "video")).toBeNull();
    expect(dropLaneOf(rows, "group:g", "track")).toBeNull();
    expect(dropLaneOf(rows, "track:orbit", "track")).toBeNull();
    expect(dropLaneOf(rows, null, "track")).toBeNull();
  });
});

// The regression: a drag reading the direction the other way hid the lane behind the full-frame one.
describe("a picture lane dragged to the top row", () => {
  it("ends up in FRONT, which is last in project.layers", () => {
    const layers = ["main", "pip", "box"]; // bottom first, as the file states them
    const rows = projectRows({ groups: [] }, [], layers.map(videoTrack));
    // The top row is what a person drops onto to mean "put it over everything".
    const onto = dropLaneOf(rows, rowKey(rows[0]), "video");
    expect(onto).toBe("box");
    const at = orderPosition(layers, onto as string);
    expect(reorderTracks(layers, "main", at as number)).toEqual([
      "pip",
      "box",
      "main",
    ]);
  });
});

describe("pictureRowId", () => {
  // `r` arms whatever the caret is on, and only a row key says which of the two arms that is.
  it("names the lane behind a picture row, and nothing behind any other", () => {
    expect(pictureRowId("video:main")).toBe("main");
    expect(pictureRowId("track:main")).toBeNull();
    expect(pictureRowId("group:g")).toBeNull();
    expect(pictureRowId(null)).toBeNull();
  });
});
