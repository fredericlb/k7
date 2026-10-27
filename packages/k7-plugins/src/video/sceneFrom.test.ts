// A lane's strip, as the scene receives it: always a pass, so a knob set live has one to move, and
// declared IDENTITY at its knobs as made, so the compositor skips it until one moves.

import { PICTURE_STRIP_SHADER } from "@studio/song-schema/moduleTypes";
import { isIdentityPass } from "@studio/ui-eyes/scene";
import type { WebVideoPlugin } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { passOf } from "./sceneFrom";

const plugin = (
  shader: string,
  params: Record<string, number>,
): WebVideoPlugin => ({
  id: "main:0",
  type: "shader",
  name: "mix",
  enabled: true,
  params,
  shader: { name: shader, vertex: "", fragment: "" },
});
const pass = (shader: string, params: Record<string, number>) => {
  const p = passOf(plugin(shader, params), (u) => u);
  if (!p) throw new Error("no pass");
  return p;
};

describe("a strip's pass", () => {
  it("is in the scene as made, and skipped there", () => {
    expect(
      isIdentityPass(
        pass(PICTURE_STRIP_SHADER, { P1: 1, P2: 1, P3: 1, P4: 0 }),
      ),
    ).toBe(true);
  });

  it("is drawn once any knob moves — a knob set live included", () => {
    const p = pass(PICTURE_STRIP_SHADER, { P1: 1, P2: 1, P3: 1, P4: 0 });
    p.params = { ...p.params, P4: 0.1 };
    expect(isIdentityPass(p)).toBe(false);
  });

  it("never makes another shader skippable, whatever its knobs say", () => {
    expect(isIdentityPass(pass("pulse", { P1: 1, P2: 1, P3: 1, P4: 0 }))).toBe(
      false,
    );
  });
});
