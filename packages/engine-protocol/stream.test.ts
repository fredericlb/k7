import { describe, expect, it } from "vitest";
import {
  decodeStreamFrame,
  encodeStreamFrame,
  STREAM_CODEC_PCM_F32,
  STREAM_CODEC_PCM_S16,
  STREAM_HEADER_BYTES,
  STREAM_MAGIC,
  STREAM_VERSION,
  type StreamFrame,
  seqGap,
} from "./stream";

const frame = (over: Partial<StreamFrame> = {}): StreamFrame => {
  const channels = over.channels ?? 2;
  const frames = over.frames ?? 4;
  return {
    version: STREAM_VERSION,
    channels,
    sampleRate: 48000,
    frames,
    seq: 7,
    codec: STREAM_CODEC_PCM_F32,
    captureMs: 1234.5,
    samples: new Float32Array(frames * channels).map((_, i) => i / 100),
    ...over,
  };
};

describe("the broadcast frame round-trips", () => {
  it("carries every header field back unchanged", () => {
    const f = frame();
    const got = decodeStreamFrame(encodeStreamFrame(f));
    expect(got).not.toBeNull();
    expect(got?.channels).toBe(2);
    expect(got?.sampleRate).toBe(48000);
    expect(got?.frames).toBe(4);
    expect(got?.seq).toBe(7);
    expect(got?.captureMs).toBeCloseTo(1234.5, 6);
  });

  it("carries the samples back bit-for-bit", () => {
    // Not "close to": a rounding difference here would mean the payload took a conversion it should not have.
    const f = frame({ frames: 64 });
    const got = decodeStreamFrame(encodeStreamFrame(f));
    expect(Array.from(got?.samples ?? [])).toEqual(Array.from(f.samples));
  });

  it("puts the payload where a Float32Array view can be taken", () => {
    // The whole reason the header is 32 bytes: a header of 30 would still decode here and throw in the browser.
    expect(STREAM_HEADER_BYTES % 4).toBe(0);
    const buf = encodeStreamFrame(frame({ frames: 8, channels: 2 }));
    expect(buf.byteLength).toBe(STREAM_HEADER_BYTES + 8 * 2 * 4);
    expect(() => new Float32Array(buf, STREAM_HEADER_BYTES, 16)).not.toThrow();
  });

  it("survives a mono frame", () => {
    const got = decodeStreamFrame(encodeStreamFrame(frame({ channels: 1 })));
    expect(got?.channels).toBe(1);
    expect(got?.samples).toHaveLength(4);
  });

  it("refuses to encode a payload that disagrees with the header", () => {
    expect(() =>
      encodeStreamFrame(frame({ samples: new Float32Array(3) })),
    ).toThrow(/samples/);
  });
});

// This decoder runs on whatever lands on a shared socket, so anything it does not fully recognise has to come back null.
describe("the decoder rejects rather than guesses", () => {
  it("ignores a buffer that is not ours", () => {
    expect(
      decodeStreamFrame(new TextEncoder().encode("hello").buffer),
    ).toBeNull();
  });

  it("ignores a buffer too short to hold a header", () => {
    expect(decodeStreamFrame(new ArrayBuffer(8))).toBeNull();
  });

  it("ignores a future version rather than misreading its header", () => {
    const buf = encodeStreamFrame(frame());
    new DataView(buf).setUint8(4, STREAM_VERSION + 1);
    expect(decodeStreamFrame(buf)).toBeNull();
  });

  it("ignores a codec it cannot decode", () => {
    // The day Opus lands, an old client must go quiet rather than play compressed bytes as PCM.
    const buf = encodeStreamFrame(frame());
    new DataView(buf).setUint8(20, 1);
    expect(decodeStreamFrame(buf)).toBeNull();
  });

  it("reads int16 samples back into the float range", () => {
    // Built by hand as the engine writes codec 2: the float frame's header, then int16 samples.
    const f = encodeStreamFrame(frame({ frames: 2, channels: 2 }));
    const buf = new ArrayBuffer(STREAM_HEADER_BYTES + 4 * 2);
    new Uint8Array(buf).set(new Uint8Array(f, 0, STREAM_HEADER_BYTES));
    new DataView(buf).setUint8(20, STREAM_CODEC_PCM_S16);
    new Int16Array(buf, STREAM_HEADER_BYTES, 4).set([32767, -32767, 0, 16384]);
    const got = decodeStreamFrame(buf);
    expect(got?.codec).toBe(STREAM_CODEC_PCM_S16);
    expect(Array.from(got?.samples ?? [])).toEqual(
      [1, -1, 0, 16384 / 32767].map(Math.fround),
    );
  });

  it("ignores a frame whose length disagrees with its header", () => {
    const buf = encodeStreamFrame(frame({ frames: 8 }));
    new DataView(buf).setUint32(12, 9, true); // says 9 frames, carries 8
    expect(decodeStreamFrame(buf)).toBeNull();
  });

  it("ignores an impossible channel count", () => {
    const buf = encodeStreamFrame(frame());
    new DataView(buf).setUint8(5, 0);
    expect(decodeStreamFrame(buf)).toBeNull();
  });

  it("ignores an impossible sample rate", () => {
    const buf = encodeStreamFrame(frame());
    new DataView(buf).setUint32(8, 12, true);
    expect(decodeStreamFrame(buf)).toBeNull();
  });

  it("writes the magic where a sniffer can see it", () => {
    expect(new DataView(encodeStreamFrame(frame())).getUint32(0, true)).toBe(
      STREAM_MAGIC,
    );
  });
});

// A gap means the sender DECIDED to drop; getting the wrap wrong would report ~4 billion dropped frames every 1.4 years at 100 fps.
describe("counting what the sender dropped", () => {
  it("is zero for consecutive frames", () => {
    expect(seqGap(41, 42)).toBe(0);
  });

  it("counts the frames that never arrived", () => {
    expect(seqGap(10, 14)).toBe(3);
  });

  it("counts zero across the 32-bit wrap", () => {
    expect(seqGap(0xffffffff, 0)).toBe(0);
  });

  it("counts correctly across the wrap", () => {
    expect(seqGap(0xfffffffe, 1)).toBe(2);
  });
});
