// trayIcon.test.ts — the drawn icon: a PNG that decodes to its pixels, the badge where it belongs, and fast enough to spin.

import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng, ICON_PX, renderPng, renderRgba } from "./trayIcon.ts";

/** The pixel at the badge's centre, (0.82, 0.82) of the square. */
function badge(rgba: Uint8Array): number[] {
  const at = Math.floor(0.82 * ICON_PX);
  const i = (at * ICON_PX + at) * 4;
  return [...rgba.subarray(i, i + 4)];
}

describe("trayIcon", () => {
  it("encodes a PNG whose IDAT inflates back to the pixels", () => {
    const rgba = renderRgba({ kind: "running" }, true);
    const png = encodePng(rgba, ICON_PX);
    expect(
      [...png.subarray(1, 4)].map((b) => String.fromCharCode(b)).join(""),
    ).toBe("PNG");
    const idatAt = png.indexOf("IDAT");
    const len = png.readUInt32BE(idatAt - 4);
    const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + len));
    const row = ICON_PX * 4 + 1;
    expect(raw.length).toBe(ICON_PX * row);
    expect([...raw.subarray(row * 10 + 1, row * 11)]).toEqual([
      ...rgba.subarray(ICON_PX * 4 * 10, ICON_PX * 4 * 11),
    ]);
  });

  it("wears green running, red stopped, and blue while loading", () => {
    const [r, g] = badge(renderRgba({ kind: "running" }, true));
    expect(g).toBeGreaterThan(r);
    const [r2, g2] = badge(renderRgba({ kind: "stopped" }, true));
    expect(r2).toBeGreaterThan(g2);
    // The spinner is a ring, so its centre is empty.
    expect(badge(renderRgba({ kind: "loading", frame: 0 }, true))[3]).toBe(0);
  });

  it("flips its ink for a light menu bar", () => {
    const at = (rgba: Uint8Array) =>
      rgba[(Math.floor(0.25 * ICON_PX) * ICON_PX + 8) * 4];
    expect(at(renderRgba({ kind: "running" }, true))).toBeGreaterThan(200);
    expect(at(renderRgba({ kind: "running" }, false))).toBeLessThan(60);
  });

  it("renders a spinner frame well within its 120 ms tick", () => {
    const t = performance.now();
    for (let i = 0; i < 30; i++)
      renderPng({ kind: "loading", frame: i % 10 }, true);
    expect((performance.now() - t) / 30).toBeLessThan(30);
  });
});
