import { describe, expect, it } from "vitest";
import type { Moment, Session } from "../types";
import { buildEntries } from "./RecordingsTimeline";

const take = (id: string) => `recordings/2026-09-01/${id}.webm`;

const session = (id: string, createdAt: string): Session => ({
  id,
  createdAt,
  duration: 60,
  hasRecording: true,
  recordingPath: take(id),
  recordingExt: null,
  recordingMime: null,
  gain: 1,
  annotations: [],
  markers: [],
});

const moment = (
  id: string,
  recording: string | null,
  startSec: number,
  tags: string[],
  createdAt = "2026-09-01T10:00:00.000Z",
  recordedAt: string | null = null,
): Moment => ({
  id,
  recordingPath: recording && take(recording),
  recordedAt,
  sessionId: null,
  recordingAvailable: recording != null,
  startSec,
  endSec: startSec + 5,
  text: "",
  tags,
  validated: false,
  createdAt,
  sharedFrom: "",
});

const s1 = session("s1", "2026-09-01T09:00:00.000Z");
const s2 = session("s2", "2026-09-01T11:00:00.000Z");
const moments = [
  moment("m2", "s1", 30, ["riff"]),
  moment("m1", "s1", 10, ["solo"]),
  moment("m3", "s2", 5, ["solo"]),
  moment("o1", "gone", 0, ["riff"], "2026-09-01T10:30:00.000Z"),
];

describe("buildEntries", () => {
  it("hangs moments under their session by offset, orphans at session level, newest first", () => {
    const entries = buildEntries([s1, s2], moments, null);
    expect(
      entries.map((e) => (e.kind === "session" ? e.session.id : e.moment.id)),
    ).toEqual(["s2", "o1", "s1"]);
    const first = entries[2];
    expect(first.kind === "session" && first.moments.map((m) => m.id)).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("keeps a session when one of its moments has the tag, showing only the matching ones", () => {
    const entries = buildEntries([s1, s2], moments, "riff");
    expect(
      entries.map((e) => (e.kind === "session" ? e.session.id : e.moment.id)),
    ).toEqual(["o1", "s1"]);
    const s = entries[1];
    expect(s.kind === "session" && s.moments.map((m) => m.id)).toEqual(["m2"]);
  });

  it("places a moment of a capture no session saved by when it was played", () => {
    const lib = moment(
      "l1",
      "lib",
      60,
      [],
      "2026-09-02T00:00:00.000Z",
      "2026-09-01T09:30:00.000Z",
    );
    const entries = buildEntries([s1, s2], [...moments, lib], null);
    expect(
      entries.map((e) => (e.kind === "session" ? e.session.id : e.moment.id)),
    ).toEqual(["s2", "o1", "l1", "s1"]);
    expect(entries[2].at).toBe("2026-09-01T09:31:00.000Z");
  });

  it("drops a session none of whose moments carries the tag", () => {
    const entries = buildEntries([s1, s2], moments, "missing");
    expect(entries).toEqual([]);
  });
});
