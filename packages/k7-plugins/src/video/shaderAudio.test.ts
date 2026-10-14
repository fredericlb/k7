// The engine's levels turned into a shader's `uAudio`: the dB window, the lookup that needs the
// track ORDER, and the asymmetric smoothing. See packages/song/docs/shaders.md.

import type { WebVideoProject } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import {
  AUDIO_FLOOR_DB,
  audioSources,
  levelsForPasses,
  levelToUnit,
  smoothLevels,
} from "./shaderAudio";

describe("levelToUnit", () => {
  it("maps the -60..0 dB window onto 0..1", () => {
    expect(levelToUnit(0)).toBe(1);
    expect(levelToUnit(AUDIO_FLOOR_DB)).toBe(0);
    expect(levelToUnit(-30)).toBeCloseTo(0.5, 5);
  });

  it("floors silence and anything under the window", () => {
    // The engine reports -100 for silence, and mapping the full range would leave every useful level crammed into the top tenth.
    expect(levelToUnit(-100)).toBe(0);
    expect(levelToUnit(-Infinity)).toBe(0);
    expect(levelToUnit(Number.NaN)).toBe(0);
  });

  it("clamps a level over full scale rather than handing GLSL a number above 1", () => {
    expect(levelToUnit(6)).toBe(1);
  });
});

describe("audioSources", () => {
  const doc = (over: Partial<WebVideoProject>): WebVideoProject =>
    ({
      name: "t",
      viewport: [640, 360],
      fps: 30,
      duration: 0,
      markers: [],
      videoTracks: [],
      framePlugins: [],
      ...over,
    }) as WebVideoProject;

  it("finds every shader pass that named a lane, on a lane and on the frame", () => {
    const got = audioSources(
      doc({
        videoTracks: [
          {
            id: "main",
            plugins: [
              {
                id: "main:0",
                type: "shader",
                name: "glow",
                enabled: true,
                params: {},
                audioFrom: "gtr",
              },
            ],
          },
        ] as WebVideoProject["videoTracks"],
        framePlugins: [
          {
            id: "RENDER:0",
            type: "shader",
            name: "grade",
            enabled: true,
            params: {},
            audioFrom: "drums",
          },
        ],
      }),
    );
    expect(got).toEqual({ "main:0": "gtr", "RENDER:0": "drums" });
  });

  it("skips a pass with nothing wired to its audio port", () => {
    // The port is optional — a shader that only uses its knobs is an ordinary video effect.
    expect(
      audioSources(
        doc({
          framePlugins: [
            {
              id: "RENDER:0",
              type: "shader",
              name: "grade",
              enabled: true,
              params: {},
            },
          ],
        }),
      ),
    ).toEqual({});
  });

  it("is empty for no document at all", () => {
    expect(audioSources(null)).toEqual({});
  });
});

describe("levelsForPasses", () => {
  it("indexes `levels` by the compiled track ORDER — the array carries no names", () => {
    // The whole reason the track list has to be threaded down to the viewport.
    expect(
      levelsForPasses({ "main:0": "drums" }, ["gtr", "drums"], [0, -30]),
    ).toEqual({ "main:0": levelToUnit(-30) });
  });

  it("gives 0 for a lane the engine does not know about", () => {
    // Not yet loaded, renamed, muted out of the document: a shader's uniform exists whatever happened, and 0 is honest for 'no signal'.
    expect(levelsForPasses({ "main:0": "ghost" }, ["gtr"], [0])).toEqual({
      "main:0": 0,
    });
  });

  it("gives 0 when the engine has sent no frame yet", () => {
    expect(levelsForPasses({ "main:0": "gtr" }, ["gtr"], [])).toEqual({
      "main:0": 0,
    });
  });
});

describe("smoothLevels", () => {
  it("rises fast and falls slowly — a visual jumps on a transient", () => {
    // Symmetric smoothing gives you either a mushy attack or a flickering decay, and there is no constant that avoids both.
    const up = smoothLevels({ a: 0 }, { a: 1 }).a;
    const down = smoothLevels({ a: 1 }, { a: 0 }).a;
    expect(up).toBeGreaterThan(0.5);
    expect(1 - down).toBeLessThan(up);
  });

  it("converges on the target rather than overshooting it", () => {
    let v: Record<string, number> = { a: 0 };
    for (let i = 0; i < 40; i++) v = smoothLevels(v, { a: 0.8 });
    expect(v.a).toBeCloseTo(0.8, 3);
  });

  it("starts a pass it has never seen at 0, not undefined", () => {
    expect(smoothLevels({}, { fresh: 1 }).fresh).toBeGreaterThan(0);
  });
});
