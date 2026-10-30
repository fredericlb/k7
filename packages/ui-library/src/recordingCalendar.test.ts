import type { RecordingDay } from "@studio/mediatek/recordings";
import type { Moment } from "@studio/rehearsal-shared";
import { describe, expect, it } from "vitest";
import { captureEntries, captureTags } from "./recordingCalendar";

const file = (day: string, name: string, mtime = 0) => ({
  name,
  path: `recordings/${day}/${name}`,
  bytes: 1,
  mtime,
});

const days: RecordingDay[] = [
  { day: "2026-08-04", files: [file("2026-08-04", "10-00-00.webm")] },
  {
    day: "2026-08-03",
    files: [
      file("2026-08-03", "09-00-00.mp3"),
      file("2026-08-03", "21-05-07.webm"),
      file("2026-08-03", "take.mp3", new Date(2026, 7, 3, 12).getTime()),
    ],
  },
];

const moment = (id: string, path: string, startSec: number, tags: string[]) =>
  ({
    id,
    recordingPath: path,
    recordedAt: null,
    sessionId: null,
    recordingAvailable: true,
    startSec,
    endSec: startSec + 5,
    text: "",
    tags,
    validated: false,
    createdAt: "",
    sharedFrom: "",
  }) satisfies Moment;

const evening = "recordings/2026-08-03/21-05-07.webm";
const moments = [
  moment("b", evening, 30, ["riff"]),
  moment("a", evening, 10, ["solo"]),
  moment("gone", "recordings/2026-01-01/10-00-00.webm", 0, ["old"]),
];

describe("the capture calendar", () => {
  it("lists every capture at its start, newest first, its moments by offset", () => {
    const entries = captureEntries(days, moments, null);
    expect(entries.map((e) => e.file.name)).toEqual([
      "10-00-00.webm",
      "21-05-07.webm",
      "take.mp3",
      "09-00-00.mp3",
    ]);
    expect(entries[1].at).toEqual(new Date(2026, 7, 3, 21, 5, 7));
    expect(entries[1].day).toBe("2026-7-3");
    expect(entries[1].moments.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("keeps, under a tag, the captures with a moment carrying it and only those moments", () => {
    const entries = captureEntries(days, moments, "riff");
    expect(entries.map((e) => e.file.name)).toEqual(["21-05-07.webm"]);
    expect(entries[0].moments.map((m) => m.id)).toEqual(["b"]);
  });

  it("offers the tags of the listed captures' moments only", () => {
    expect(captureTags(days, moments)).toEqual(["riff", "solo"]);
  });
});
