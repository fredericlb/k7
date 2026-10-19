// Reading and REWRITING a clip file's window from the buffer's k7x text — what dragging the band's
// edges in the waveform commits. The load-bearing rule is the SPELLING: a number is seconds and a
// timecode is musical, and a drag must not convert one into the other behind your back.

import { parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import {
  clipWindowBand,
  scanClipWindow,
  setClipWindowText,
} from "./clipWindowText";

// 110 BPM: one bar is 240/110 s, so "3:1" (8 beats) is 8*60/110 = 4.363636… s.
const G = { tempo: 110, num: 4, den: 4 };
const BAR = 240 / 110;

const FILE = `// the break
source("clips/break.wav")
warp({ algorithm: "slice", markers: [[0, 0], [4, 1.9]] })
`;

describe("reading the window", () => {
  it("says nothing when the file states neither edge", () => {
    expect(clipWindowBand(FILE, G)).toBeUndefined();
  });

  it("reads a window written in seconds", () => {
    const band = clipWindowBand(`${FILE}from(1.32)\nto(4.36)\n`, G);
    expect(band).toEqual([{ symbol: "clip", from: 1.32, to: 4.36 }]);
  });

  it("reads one written as a timecode, at the project's tempo", () => {
    const band = clipWindowBand(`${FILE}to("3:1")\n`, G);
    expect(band?.[0]?.from).toBe(0);
    expect(band?.[0]?.to).toBeCloseTo(2 * BAR, 9);
  });

  it("an unwritten `to` is the file's end, which only the view can place", () => {
    expect(clipWindowBand(`${FILE}from(1.5)\n`, G)?.[0]?.to).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("ignores a `from` nested inside another value", () => {
    const nested = 'source("a.wav")\nslices({ x: { from: 9, to: 10 } })\n';
    expect(scanClipWindow(nested)).toEqual({});
    expect(clipWindowBand(nested, G)).toBeUndefined();
  });

  it("draws nothing for a text that does not read rather than jumping about", () => {
    expect(clipWindowBand(`${FILE}to("3:\n`, G)).toBeUndefined();
    expect(clipWindowBand(`${FILE}to("3:")\n`, G)).toBeUndefined();
  });

  it("offers HOLLOW edges on an untrimmed clip when the buffer can be edited", () => {
    // Nothing to shade — but the edges are the handles, and without them an untrimmed clip could never be trimmed by dragging.
    expect(clipWindowBand(FILE, G, true)).toEqual([
      {
        symbol: "clip",
        from: 0,
        to: Number.POSITIVE_INFINITY,
        hollow: true,
      },
    ]);
  });

  it("a real window is never hollow, editable or not", () => {
    expect(clipWindowBand(`${FILE}from(1)\n`, G, true)?.[0]?.hollow).toBe(
      undefined,
    );
  });
});

describe("writing a dragged edge", () => {
  it("keeps SECONDS as seconds", () => {
    const out = setClipWindowText(`${FILE}from(1.32)\nto(4.36)\n`, 2, 5, G);
    expect(parse(out)).toMatchObject({ from: 2, to: 5 });
  });

  it("keeps a TIMECODE as a timecode, at the same position", () => {
    // The whole point: this edge was pinned to a bar and stays pinned to one, so a tempo change still moves it.
    const out = setClipWindowText(`${FILE}to("3:1")\n`, 0, 3 * BAR, G);
    expect(parse(out).to).toBe("4:1");
  });

  it("round-trips a timecode edge that did not move", () => {
    const before = `${FILE}from("2:1")\nto("3:1")\n`;
    const band = clipWindowBand(before, G);
    const after = setClipWindowText(
      before,
      band?.[0]?.from ?? 0,
      band?.[0]?.to ?? 0,
      G,
    );
    expect(after).toBe(before);
  });

  it("writes seconds for an edge that was not there — there is no intent to keep", () => {
    const out = setClipWindowText(FILE, 1.5, 4, G);
    expect(parse(out)).toMatchObject({ from: 1.5, to: 4 });
    expect(out).toContain("\nfrom(1.5)\n");
  });

  it("DELETES `from` when it is dragged back to the start", () => {
    // Absent already means the material's start; a written 0 makes 'not trimmed' and 'trimmed to the beginning' read alike.
    const out = setClipWindowText(`${FILE}from(1.32)\nto(4.36)\n`, 0, 4.36, G);
    expect(parse(out).from).toBeUndefined();
    expect(parse(out).to).toBe(4.36);
  });

  it("leaves `to` out when the edge is the file's end", () => {
    const out = setClipWindowText(
      `${FILE}from(1)\nto(4)\n`,
      2,
      Number.POSITIVE_INFINITY,
      G,
    );
    expect(parse(out).from).toBe(2);
    expect(parse(out).to).toBeUndefined();
  });

  it("touches nothing else in the file", () => {
    const out = setClipWindowText(`${FILE}from(1.32)\nto(4.36)\n`, 2, 5, G);
    expect(out.startsWith(FILE)).toBe(true);
  });

  it("keeps a trailing comment on the line it rewrites", () => {
    const out = setClipWindowText(
      `${FILE}from(1.32) // the count-in\nto(4.36)\n`,
      2,
      4.36,
      G,
    );
    expect(out).toContain("from(2) // the count-in");
  });

  it("commits at 0.1 ms, which is finer than a sample", () => {
    expect(parse(setClipWindowText(FILE, 0, 1 / 3, G)).to).toBe(0.3333);
  });

  it("writes nothing at all when a hollow band is released unmoved", () => {
    // Dragging neither edge of an untrimmed clip must leave the file alone: a `from` of 0 is deleted and an infinite `to` says nothing.
    const band = clipWindowBand(FILE, G, true)?.[0];
    const out = setClipWindowText(FILE, band?.from ?? 0, band?.to ?? 0, G);
    expect(out).toBe(FILE);
  });

  it("turns a hollow band into a real window once an edge moves", () => {
    const out = setClipWindowText(FILE, 0, 2.5, G);
    expect(parse(out).to).toBe(2.5);
    expect(parse(out).from).toBeUndefined();
  });

  it("leaves a text that does not read as it is", () => {
    const broken = `${FILE}to(\n`;
    expect(setClipWindowText(broken, 1, 2, G)).toBe(broken);
  });
});
