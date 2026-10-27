// A lane's strip, as the scene receives it: left as made it is no pass at all, so the compositor keeps
// the lane on its cheap path; a knob moved off neutral makes it a pass like any shader.

import { PICTURE_STRIP_SHADER } from "@studio/song-schema/moduleTypes";
import type { WebVideoPlugin } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { isNeutralStrip } from "./sceneFrom";

const strip = (params: Record<string, number>): WebVideoPlugin => ({
  id: "main:0",
  type: "shader",
  name: "mix",
  enabled: true,
  params,
  shader: { name: PICTURE_STRIP_SHADER, vertex: "", fragment: "" },
});

describe("isNeutralStrip", () => {
  it("is true as made: each channel whole, the lane opaque", () => {
    expect(isNeutralStrip(strip({ P1: 1, P2: 1, P3: 1, P4: 0 }))).toBe(true);
  });

  it("is false once any knob moves", () => {
    expect(isNeutralStrip(strip({ P1: 1, P2: 0.5, P3: 1, P4: 0 }))).toBe(false);
    expect(isNeutralStrip(strip({ P1: 1, P2: 1, P3: 1, P4: 0.1 }))).toBe(false);
  });

  it("never drops another shader, whatever its knobs say", () => {
    const glow = { ...strip({ P1: 1, P2: 1, P3: 1, P4: 0 }) };
    glow.shader = { name: "pulse", vertex: "", fragment: "" };
    expect(isNeutralStrip(glow)).toBe(false);
  });
});
