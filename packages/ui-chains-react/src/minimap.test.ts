// The minimap's one piece of arithmetic: the whole drawing fitted into the map, which a press on the
// map then reads backwards to find the WORLD point to centre on.

import { describe, expect, it } from "vitest";
import { MAP_H, MAP_W, projection } from "./Minimap";

describe("the minimap projection", () => {
  it("fits the drawing inside the map, aspect kept, on its tighter axis", () => {
    const { s } = projection({ left: 0, top: 0, width: 2000, height: 1000 });
    expect(2000 * s).toBeLessThanOrEqual(MAP_W);
    expect(1000 * s).toBeLessThanOrEqual(MAP_H);
  });

  it("centres it, a drawing that begins above and left of the origin included", () => {
    // A pin may put a card at negative coordinates; the box runs from `left`/`top`, not from 0.
    const b = { left: -500, top: -300, width: 1500, height: 900 };
    const { s, ox, oy } = projection(b);
    const midX = ox + ((b.left + b.width) / 2) * s;
    const midY = oy + ((b.top + b.height) / 2) * s;
    expect(midX).toBeCloseTo(MAP_W / 2);
    expect(midY).toBeCloseTo(MAP_H / 2);
  });

  it("reads a map point back to the world point drawn there", () => {
    const b = { left: 0, top: 0, width: 3000, height: 1200 };
    const { s, ox, oy } = projection(b);
    const world = { x: 1234, y: 567 };
    const on = { x: ox + world.x * s, y: oy + world.y * s };
    expect((on.x - ox) / s).toBeCloseTo(world.x);
    expect((on.y - oy) / s).toBeCloseTo(world.y);
  });
});
