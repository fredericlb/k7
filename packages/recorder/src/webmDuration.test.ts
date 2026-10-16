import { describe, expect, it } from "vitest";
import { patchWebmDuration, patchWebmHead } from "./webmDuration";

const el = (id: number[], data: number[], unknownSize = false) => [
  ...id,
  ...(unknownSize
    ? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
    : [0x80 | data.length]),
  ...data,
];

const EBML = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], [0x77, 0x65]));
const SCALE = el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]);
const INFO = el([0x15, 0x49, 0xa9, 0x66], [...SCALE, ...el([0x4d, 0x80], [])]);
const TRACKS = el([0x16, 0x54, 0xae, 0x6b], [0xaa, 0xbb]);
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff];
CLUSTER.push(0xff, 0xff, 1, 2, 3, 4);

/** The duration a patched head carries, read back as a float64 after its element id. */
function durationOf(bytes: Uint8Array): number {
  for (let i = 0; i + 11 <= bytes.length; i++) {
    if (bytes[i] === 0x44 && bytes[i + 1] === 0x89 && bytes[i + 2] === 0x88)
      return new DataView(bytes.buffer, bytes.byteOffset).getFloat64(i + 3);
  }
  return Number.NaN;
}

describe("patchWebmHead", () => {
  it("appends a Duration to Info in a MediaRecorder-shaped file", () => {
    const seg = el(
      [0x18, 0x53, 0x80, 0x67],
      [...INFO, ...TRACKS, ...CLUSTER],
      true,
    );
    const file = new Uint8Array([...EBML, ...seg]);
    const out = patchWebmHead(file, 12_345);
    if (!out) throw new Error("not patched");
    expect(durationOf(out.bytes)).toBe(12_345);
    // What follows Info is left to the original bytes.
    const rest = file.subarray(out.consumed);
    expect([...rest.subarray(0, 4)]).toEqual([0x16, 0x54, 0xae, 0x6b]);
    // Info grew by the 11 bytes of the Duration element.
    const infoSizeAt = EBML.length + 12 + 4;
    expect(out.bytes[infoSizeAt]).toBe(0x80 | (INFO.length - 5 + 11));
  });

  it("grows a sized Segment and shifts the SeekPositions past Info", () => {
    const seekPos = INFO.length + 30;
    const seek = el(
      [0x4d, 0xbb],
      [
        ...el([0x53, 0xab], [0x16, 0x54, 0xae, 0x6b]),
        ...el([0x53, 0xac], [0, seekPos]),
      ],
    );
    const seekHead = el([0x11, 0x4d, 0x9b, 0x74], seek);
    const body = [...seekHead, ...INFO, ...TRACKS];
    const seg = [0x18, 0x53, 0x80, 0x67, 0x40, body.length, ...body];
    const out = patchWebmHead(new Uint8Array([...EBML, ...seg]), 1000);
    if (!out) throw new Error("not patched");
    const b = out.bytes;
    expect(b[EBML.length + 5]).toBe(body.length + 11);
    const posAt = b.indexOf(0xac) + 2;
    expect(b[posAt + 1]).toBe(seekPos + 11);
  });

  it("leaves a file that already has a duration alone", () => {
    const dur = el([0x44, 0x89], [0x40, 0x8f, 0x40, 0, 0, 0, 0, 0]);
    const info = el([0x15, 0x49, 0xa9, 0x66], [...SCALE, ...dur]);
    const seg = el([0x18, 0x53, 0x80, 0x67], [...info, ...CLUSTER], true);
    const out = patchWebmHead(new Uint8Array([...EBML, ...seg]), 5);
    expect(out?.consumed).toBe(0);
  });

  it("refuses what is not a WebM", () => {
    expect(patchWebmHead(new Uint8Array([1, 2, 3, 4]), 5)).toBeNull();
  });
});

describe("patchWebmDuration", () => {
  it("keeps the tail as the original bytes", async () => {
    const seg = el([0x18, 0x53, 0x80, 0x67], [...INFO, ...CLUSTER], true);
    const file = new Uint8Array([...EBML, ...seg]);
    const blob = new Blob([file], { type: "audio/webm" });
    const fixed = await patchWebmDuration(blob, 2000);
    if (!fixed) throw new Error("not patched");
    expect(fixed.size).toBe(file.length + 11);
    expect(fixed.type).toBe("audio/webm");
    const bytes = new Uint8Array(await fixed.arrayBuffer());
    expect([...bytes.subarray(bytes.length - 4)]).toEqual([1, 2, 3, 4]);
  });
});
