// The timeline pane's document: the song's, or a timeline's lanes in place of its tracks.

import type { WebProject } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { timelineView } from "./timelineView";

const lane = (id: string) =>
  ({ id, name: id, clips: [] }) as unknown as WebProject["tracks"][number];
const song = {
  name: "s",
  tracks: [lane("gtr")],
  groups: [{ id: "g" }],
  markers: [{ beat: 0, name: "a", tc: "1:1" }],
  timelines: [{ id: "verse", length: 8, lanes: [lane("verse>drums")] }],
} as unknown as WebProject;

describe("timelineView", () => {
  it("is the song's document with no timeline open", () => {
    expect(timelineView(song, null)).toEqual({ doc: song, timeline: null });
  });

  it("puts the open timeline's lanes in place of the song's tracks, with no groups or markers", () => {
    const { doc, timeline } = timelineView(song, "verse");
    expect(timeline?.id).toBe("verse");
    expect(doc.tracks.map((t) => t.id)).toEqual(["verse>drums"]);
    expect(doc.groups).toEqual([]);
    expect(doc.markers).toEqual([]);
  });

  it("falls back to the song when the timeline is gone", () => {
    expect(timelineView(song, "chorus").doc).toBe(song);
  });
});
