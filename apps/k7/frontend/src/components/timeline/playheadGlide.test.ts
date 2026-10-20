// playheadGlide.test.ts — the glide is restarted only when the clock disagrees, and parked when the transport stops.
import { describe, expect, it, vi } from "vitest";
import {
  GLIDE_TOLERANCE_PX,
  glideHolds,
  glidePosition,
  NO_GLIDE,
  steerGlide,
} from "./playheadGlide";

function fakeEl() {
  const cancels: ReturnType<typeof vi.fn>[] = [];
  const el = {
    style: { transform: "" },
    animate: vi.fn(() => {
      const cancel = vi.fn();
      cancels.push(cancel);
      return { cancel } as unknown as Animation;
    }),
  };
  return { el: el as unknown as HTMLElement & typeof el, cancels };
}

describe("playheadGlide", () => {
  it("predicts a linear position, capped at the range's end", () => {
    const g = {
      ...NO_GLIDE,
      anim: {} as Animation,
      x0: 10,
      t0: 1000,
      xEnd: 50,
      pxPerMs: 0.01,
    };
    expect(glidePosition(g, 2000)).toBe(20);
    expect(glidePosition(g, 1e9)).toBe(50);
    expect(glidePosition(NO_GLIDE, 2000)).toBeNull();
  });

  it("holds within tolerance and on the same course only", () => {
    const g = {
      ...NO_GLIDE,
      anim: {} as Animation,
      x0: 0,
      t0: 0,
      xEnd: 100,
      pxPerMs: 0.01,
    };
    expect(glideHolds(g, 10 + GLIDE_TOLERANCE_PX / 2, 100, 0.01, 1000)).toBe(
      true,
    );
    expect(glideHolds(g, 10 + GLIDE_TOLERANCE_PX * 2, 100, 0.01, 1000)).toBe(
      false,
    );
    expect(glideHolds(g, 10, 120, 0.01, 1000)).toBe(false);
    expect(glideHolds(g, 10, 100, 0.02, 1000)).toBe(false);
  });

  it("starts one animation, keeps it while the clock agrees, restarts on a seek", () => {
    const { el, cancels } = fakeEl();
    let g = steerGlide(el, NO_GLIDE, 0, 100, 0.01, true, 0);
    expect(el.animate).toHaveBeenCalledTimes(1);
    for (let t = 16; t < 2000; t += 16)
      g = steerGlide(el, g, t * 0.01, 100, 0.01, true, t);
    expect(el.animate).toHaveBeenCalledTimes(1);
    g = steerGlide(el, g, 60, 100, 0.01, true, 2000);
    expect(el.animate).toHaveBeenCalledTimes(2);
    expect(cancels[0]).toHaveBeenCalled();
    expect(g.x0).toBe(60);
  });

  it("parks the line and drops the animation when stopped", () => {
    const { el, cancels } = fakeEl();
    const g = steerGlide(el, NO_GLIDE, 5, 100, 0.01, true, 0);
    const parked = steerGlide(el, g, 7, 100, 0.01, false, 200);
    expect(cancels[0]).toHaveBeenCalled();
    expect(parked.anim).toBeNull();
    expect(el.style.transform).toBe("translateX(7px)");
  });
});
