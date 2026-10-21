// The mixdown of ONE timeline: rendered as it is auditioned, named after it, and refused when the
// project holds no such timeline (@studio/song docs/timelines.md).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClipDoc, ProjectDoc, TrackDoc } from "@studio/song/project";
import { describe, expect, it, vi } from "vitest";

const rendered: ProjectDoc[] = [];
vi.mock("./renderers.ts", () => ({
  serviceRenderer: () => async (doc: ProjectDoc, out: string) => {
    rendered.push(doc);
    writeFileSync(join(out, "mix.wav"), "");
    return { mix: "mix.wav", stems: [] };
  },
}));
const { exportMix } = await import("./shareOps.ts");

const clip = (over: Partial<ClipDoc>): ClipDoc => ({
  id: "a@0",
  type: "audio",
  name: "a",
  source: "",
  start: 0,
  length: 1,
  offset: 0,
  fadeIn: 0,
  fadeOut: 0,
  loopStart: 0,
  loopEnd: 0,
  notes: [],
  ...over,
});
const track = (id: string, clips: ClipDoc[]): TrackDoc => ({
  id,
  name: id,
  role: "regular",
  contentType: "audio",
  group: "",
  generated: false,
  color: "",
  mute: false,
  solo: false,
  disabled: false,
  inputChannels: [],
  outputChannels: [],
  monitor: "off",
  inputGain: 0,
  clips,
  plugins: [],
  sends: [],
  automation: [],
});
const nest = { of: "verse@8", ref: "verse", start: 8, length: 4 };
const doc = {
  name: "t",
  tempo: 120,
  tracks: [
    track("song", [clip({ id: "verse@8>a@0", start: 8, nest })]),
    track("other", [clip({})]),
  ],
  markers: [],
  timelines: [
    {
      id: "verse",
      length: 4,
      lanes: [
        {
          id: "verse>d",
          name: "d",
          color: "",
          disabled: false,
          clips: [clip({})],
        },
      ],
    },
  ],
} as unknown as ProjectDoc;
const host = {
  root: "/ws",
  requireActive: () => "/ws/t.k7",
  cachedProjectDoc: () => doc,
};

describe("exporting one timeline", () => {
  it("renders it alone through its lane, and names the file after it", async () => {
    const out = await exportMix(host, "wav", "verse");
    out.cleanup();
    expect(out.filename).toBe("t-verse.wav");
    const sent = rendered.at(-1);
    expect(sent?.tracks.find((t) => t.id === "song")?.clips[0].start).toBe(0);
    expect(sent?.tracks.find((t) => t.id === "other")?.mute).toBe(true);
  });

  it("renders the song itself with no timeline named", async () => {
    const out = await exportMix(host, "wav");
    out.cleanup();
    expect(out.filename).toBe("t.wav");
    expect(rendered.at(-1)).toBe(doc);
  });

  it("refuses a timeline the project does not hold", async () => {
    await expect(exportMix(host, "wav", "chorus")).rejects.toThrow(
      /no timeline "chorus"/,
    );
  });
});
