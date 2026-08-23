// videoSpans.test.ts — the spans a rippling cable is decided by must agree with the frame the
// viewport actually draws, so the interval rule is asserted against `activeAt` itself rather
// than restated here. A shape lane is the one case activeAt cannot answer (it has no clips) and
// is checked against the driver's own rule: it draws while unhidden.

import { activeAt } from "@studio/ui-eyes/timeline";
import type { WebVideoProject, WebVideoTrack } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { videoSpans } from "./videoSpans";

const clip = (start: number, length: number, id = `c${start}`) => ({
  id,
  name: id,
  src: `${id}.mp4`,
  start,
  length,
  sourceFrom: 0,
});

const lane = (over: Partial<WebVideoTrack>): WebVideoTrack =>
  ({
    id: "cam",
    name: "cam",
    color: "#fff",
    mute: false,
    kind: "video",
    x: 0,
    y: 0,
    w: 1920,
    h: 1080,
    clips: [],
    shapes: [],
    ...over,
  }) as WebVideoTrack;

const doc = (tracks: WebVideoTrack[]): WebVideoProject =>
  ({ videoTracks: tracks }) as WebVideoProject;

// The layer activeAt reads — the same lane, adapted the way scene.ts adapts one.
const layer = (t: WebVideoTrack) => ({
  id: t.id,
  hidden: t.mute,
  x: t.x,
  y: t.y,
  w: t.w,
  h: t.h,
  clips: t.clips,
});

const live = (
  spans: Record<string, { from: number; to: number }[]>,
  t: number,
) =>
  Object.entries(spans).some(([, ss]) =>
    ss.some((s) => t >= s.from && t < s.to),
  );

describe("videoSpans", () => {
  it("says what the compositor says, over a cut, a gap and a natural-length shot", () => {
    // 0–2 a shot, 2–4 nothing, 4–… a shot with no length, then one that ends it at 8.
    const t = lane({
      clips: [clip(0, 2), clip(4, 0), clip(8, 1)],
    });
    const spans = videoSpans(doc([t]));
    const l = layer(t);
    for (let x = 0; x < 12; x += 0.25)
      expect([x, live(spans, x)]).toEqual([x, activeAt(l, x) !== null]);
  });

  it("agrees with it on shots written out of order too", () => {
    // Authored order is whatever somebody typed and activeAt reads it as typed — including a length-0 shot whose next one starts before it.
    const t = lane({ clips: [clip(6, 0), clip(1, 2)] });
    const spans = videoSpans(doc([t]));
    const l = layer(t);
    for (let x = 0; x < 10; x += 0.25)
      expect([x, live(spans, x)]).toEqual([x, activeAt(l, x) !== null]);
  });

  it("leaves out a hidden lane, and a lane holding nothing", () => {
    expect(
      videoSpans(
        doc([
          lane({ id: "hidden", mute: true, clips: [clip(0, 4)] }),
          lane({ id: "empty" }),
        ]),
      ),
    ).toEqual({});
  });

  it("gives a shape lane one endless span — it draws while unhidden", () => {
    const spans = videoSpans(
      doc([
        lane({
          id: "titles",
          kind: "shape",
          shapes: [
            { type: "square", x: 0, y: 0, w: 10, h: 10, color: "#fff" },
          ] as WebVideoTrack["shapes"],
        }),
      ]),
    );
    expect(spans).toEqual({
      titles: [{ from: 0, to: Number.POSITIVE_INFINITY }],
    });
  });
});
