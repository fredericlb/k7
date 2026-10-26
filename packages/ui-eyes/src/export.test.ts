// export.test.ts — which sources the export probes before frame 0: a subtitle file handed to the
// container reader fails the whole export with "unsupported or unrecognizable format".

import { describe, expect, it } from "vitest";
import { decodedSources } from "./export";
import type { SceneClip, VideoLayer, VideoScene } from "./scene";

const clip = (src: string, extra: Partial<SceneClip> = {}): SceneClip => ({
  id: src,
  src,
  start: 0,
  length: 10,
  sourceFrom: 0,
  ...extra,
});

const layer = (id: string, clips: SceneClip[]): VideoLayer => ({
  id,
  hidden: false,
  x: 0,
  y: 0,
  w: 720,
  h: 1280,
  clips,
});

const scene = (layers: VideoLayer[]): VideoScene => ({
  viewport: [720, 1280],
  fps: 30,
  layers,
  durationSec: 10,
});

describe("decodedSources", () => {
  it("probes each video once, under the first lane placing it", () => {
    const s = scene([
      layer("cam", [clip("a.mp4"), clip("b.mp4")]),
      layer("pip", [clip("a.mp4")]),
    ]);
    expect([...decodedSources(s)]).toEqual([
      ["a.mp4", "cam"],
      ["b.mp4", "cam"],
    ]);
  });

  it("leaves out a still and a subtitle clip, which are no container", () => {
    const s = scene([
      layer("cam", [clip("shot.mp4"), clip("logo.png", { still: true })]),
      layer("subs", [clip("subs.srt", { captions: { cues: [], style: {} } })]),
    ]);
    expect([...decodedSources(s).keys()]).toEqual(["shot.mp4"]);
  });
});
