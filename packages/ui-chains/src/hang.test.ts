// The cable's shape and its physics. What is worth pinning: the endpoints are EXACT (a cable
// that misses its socket by a sample reads as unplugged), the sag goes DOWN and scales with
// the horizontal run (gravity, not decoration), a down-flow cable still arrives from above,
// and the spring lags, swings, and genuinely STOPS — a loop that never settles never sleeps.

import { describe, expect, it } from "vitest";
import {
  exciteSway,
  HANG_DROOP_MIN,
  hangPoints,
  newSway,
  SWAY_MAX,
  stepSway,
} from "./hang";

const A = { x: 0, y: 0 };

describe("hangPoints", () => {
  it("starts and ends exactly on the sockets", () => {
    const b = { x: 300, y: 40 };
    const path = hangPoints(A, b);
    expect(path[0]).toEqual(A);
    const end = path[path.length - 1];
    expect(end.x).toBeCloseTo(b.x, 9);
    expect(end.y).toBeCloseTo(b.y, 9);
  });

  it("sags below the chord, more for a wider horizontal run", () => {
    const sag = (dx: number) =>
      Math.max(...hangPoints(A, { x: dx, y: 0 }).map((p) => p.y));
    expect(sag(120)).toBeGreaterThan(HANG_DROOP_MIN);
    expect(sag(300)).toBeGreaterThan(sag(120));
  });

  it("hangs nearly straight on a vertical drop — gravity pulls along the cable", () => {
    const path = hangPoints(A, { x: 0, y: 300 });
    // No sideways bow: a vertical cable has nowhere to sag but along itself.
    expect(Math.max(...path.map((p) => Math.abs(p.x)))).toBeLessThan(1e-6);
  });

  it("leaves the OUT socket downward and arrives at the IN socket from above", () => {
    const path = hangPoints(A, { x: 200, y: 160 });
    // The first step goes DOWN out of the plate…
    expect(path[1].y).toBeGreaterThan(path[0].y);
    // …and the last step comes DOWN into the target — never up from under the card.
    const n = path.length;
    expect(path[n - 1].y).toBeGreaterThan(path[n - 2].y);
  });

  it("the across form hammocks: both sides droop below their side sockets", () => {
    const b = { x: 260, y: 0 };
    const path = hangPoints(A, b, true);
    const mid = path[Math.floor(path.length / 2)];
    expect(mid.y).toBeGreaterThan(A.y);
    expect(mid.y).toBeGreaterThan(b.y);
  });

  it("degenerates to its two points when the sockets touch", () => {
    expect(hangPoints(A, { x: 0.2, y: 0 })).toHaveLength(2);
  });
});

describe("the sway spring", () => {
  it("first sighting excites nothing — a cable does not swing on mount", () => {
    const s = newSway();
    exciteSway(s, A, { x: 100, y: 0 });
    expect(s.ox).toBe(0);
    expect(s.oy).toBe(0);
  });

  it("endpoint motion becomes opposite offset — the slack lags its ends", () => {
    const s = newSway();
    exciteSway(s, A, { x: 100, y: 0 });
    exciteSway(s, { x: 20, y: 0 }, { x: 120, y: 0 }); // both ends moved +20 in x
    expect(s.ox).toBeLessThan(0);
    expect(s.oy).toBe(0);
  });

  it("swings back and genuinely settles to exact zero", () => {
    const s = newSway();
    s.ox = 30;
    let crossed = false;
    let moving = true;
    for (let i = 0; i < 60 * 10 && moving; i++) {
      moving = stepSway(s, 1 / 60);
      if (s.ox < 0) crossed = true; // underdamped: it overshoots at least once
    }
    expect(crossed).toBe(true);
    expect(moving).toBe(false);
    expect(s.ox).toBe(0);
    expect(s.vy).toBe(0);
  });

  it("clamps however hard the ends move — slack is finite", () => {
    const s = newSway();
    s.ox = 500;
    s.oy = 500;
    stepSway(s, 1 / 60);
    expect(Math.hypot(s.ox, s.oy)).toBeLessThanOrEqual(SWAY_MAX + 1e-9);
  });
});
