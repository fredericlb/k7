// stream.ts — the engine's audio broadcast frame: a 32-byte header then interleaved
// float32 samples, carried as a BINARY WebSocket message on the same socket as the JSON.
// Unlike the type-only subpaths beside it this one emits code, because both ends have to
// agree on bytes rather than on shapes. See ../engine-browser/docs/streaming.md for every choice made here.

/** "LSTR" — so a binary frame from anything else is rejected instead of played as noise. */
export const STREAM_MAGIC = 0x4c535452;
export const STREAM_VERSION = 1;
/** Header size, and therefore the payload's offset; a multiple of 4, since the payload is a Float32Array view over the same buffer. */
export const STREAM_HEADER_BYTES = 32;

/** The only codec the first cut speaks. Opus would be 1 — ../engine-browser/docs/streaming.md says why not yet. */
export const STREAM_CODEC_PCM_F32 = 0;

export interface StreamFrameHeader {
  version: number;
  channels: number;
  sampleRate: number;
  /** Samples PER CHANNEL. The payload holds `frames * channels` values, interleaved. */
  frames: number;
  /** Wraps at 2^32; the transport is TCP, so a gap is never a loss in flight but always the SENDER's decision under backpressure. */
  seq: number;
  codec: number;
  /** The engine's steady clock, ms since its boot; only DIFFERENCES mean anything — see ../engine-browser/docs/streaming.md. */
  captureMs: number;
}

export interface StreamFrame extends StreamFrameHeader {
  samples: Float32Array;
}

// A zero-copy Float32Array view uses the PLATFORM byte order, so the assumption is asserted once rather than paid per sample.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function assertEndianness(): void {
  if (!LITTLE_ENDIAN)
    throw new Error(
      "engine audio streaming assumes a little-endian host; see @studio/engine-protocol/stream",
    );
}

/** Build a frame's bytes. Used by the engine's tests and by any synthetic feeder. */
export function encodeStreamFrame(frame: StreamFrame): ArrayBuffer {
  assertEndianness();
  const count = frame.frames * frame.channels;
  if (frame.samples.length !== count)
    throw new Error(
      `stream frame: ${frame.samples.length} samples for ${frame.frames}×${frame.channels}`,
    );
  const buf = new ArrayBuffer(STREAM_HEADER_BYTES + count * 4);
  const dv = new DataView(buf);
  dv.setUint32(0, STREAM_MAGIC, true);
  dv.setUint8(4, frame.version);
  dv.setUint8(5, frame.channels);
  dv.setUint16(6, 0, true); // reserved
  dv.setUint32(8, frame.sampleRate, true);
  dv.setUint32(12, frame.frames, true);
  dv.setUint32(16, frame.seq, true);
  dv.setUint8(20, frame.codec);
  dv.setUint8(21, 0); // reserved
  dv.setUint16(22, 0, true); // reserved
  dv.setFloat64(24, frame.captureMs, true);
  new Float32Array(buf, STREAM_HEADER_BYTES, count).set(frame.samples);
  return buf;
}

/** Read a frame, or `null` on every disagreement rather than a throw: this runs on whatever arrives on a socket that also carries JSON. */
export function decodeStreamFrame(buf: ArrayBuffer): StreamFrame | null {
  assertEndianness();
  if (buf.byteLength < STREAM_HEADER_BYTES) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== STREAM_MAGIC) return null;
  const version = dv.getUint8(4);
  if (version !== STREAM_VERSION) return null;
  const channels = dv.getUint8(5);
  const sampleRate = dv.getUint32(8, true);
  const frames = dv.getUint32(12, true);
  const seq = dv.getUint32(16, true);
  const codec = dv.getUint8(20);
  if (codec !== STREAM_CODEC_PCM_F32) return null;
  // A channel count of 0, or one the browser cannot lay out, would make an empty or misaligned view rather than an obvious failure.
  if (channels < 1 || channels > 2) return null;
  if (sampleRate < 8000 || sampleRate > 384000) return null;
  const count = frames * channels;
  if (buf.byteLength !== STREAM_HEADER_BYTES + count * 4) return null;
  return {
    version,
    channels,
    sampleRate,
    frames,
    seq,
    codec,
    captureMs: dv.getFloat64(24, true),
    samples: new Float32Array(buf, STREAM_HEADER_BYTES, count),
  };
}

/** How many frames were dropped between `prev` and `seq`, across the 32-bit wrap. */
export function seqGap(prev: number, seq: number): number {
  return ((seq - prev - 1) >>> 0) & 0xffffffff;
}
