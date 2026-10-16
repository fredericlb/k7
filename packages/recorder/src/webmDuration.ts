// webmDuration.ts — writes the duration MediaRecorder leaves out of a WebM, by patching the header alone.
// What reads wrong: only the first bytes are ever read; the rest of the take stays a Blob slice, never copied (../docs/recorder.md).

/** Bytes read from the start of the take: the EBML header, the Segment's head and its Info all sit well inside. */
const HEAD_BYTES = 64 * 1024;

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEKHEAD = 0x114d9b74;
const ID_SEEK = 0x4dbb;
const ID_SEEKPOSITION = 0x53ac;
const ID_INFO = 0x1549a966;
const ID_TIMECODESCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

interface Vint {
  value: number;
  width: number;
  unknown: boolean;
}

/** The take with its duration written, or null when its layout is not the one this patcher knows. */
export async function patchWebmDuration(
  blob: Blob,
  durationMs: number,
): Promise<Blob | null> {
  const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  const patched = patchWebmHead(head, durationMs);
  if (!patched) return null;
  if (patched.consumed === 0) return blob;
  return new Blob([patched.bytes as BlobPart, blob.slice(patched.consumed)], {
    type: blob.type,
  });
}

/** `bytes` replaces the first `consumed` bytes of the file; consumed 0 means it already had a duration. */
export function patchWebmHead(
  head: Uint8Array,
  durationMs: number,
): { bytes: Uint8Array; consumed: number } | null {
  try {
    return patch(head, durationMs);
  } catch {
    return null;
  }
}

function patch(head: Uint8Array, durationMs: number) {
  const ebml = readElement(head, 0);
  if (ebml.id !== ID_EBML || ebml.size.unknown) return null;
  const segAt = ebml.dataStart + ebml.size.value;
  const seg = readElement(head, segAt);
  if (seg.id !== ID_SEGMENT) return null;
  const segData = seg.dataStart;

  // Walk the Segment's first children up to Info, noting a SeekHead whose positions follow it.
  let seekHead: { start: number; end: number } | null = null;
  let p = segData;
  let info: ReturnType<typeof readElement> | null = null;
  while (p < head.length) {
    const el = readElement(head, p);
    if (el.id === ID_INFO) {
      info = el;
      break;
    }
    if (el.size.unknown) return null;
    if (el.id === ID_SEEKHEAD)
      seekHead = { start: el.dataStart, end: el.dataStart + el.size.value };
    p = el.dataStart + el.size.value;
  }
  if (!info || info.size.unknown) return null;
  const infoEnd = info.dataStart + info.size.value;
  if (infoEnd > head.length) return null;

  let scale = 1_000_000;
  let durationAt = -1;
  let durationLen = 0;
  for (let q = info.dataStart; q < infoEnd; ) {
    const el = readElement(head, q);
    if (el.id === ID_TIMECODESCALE)
      scale = readUint(head, el.dataStart, el.size.value);
    if (el.id === ID_DURATION) {
      durationAt = el.dataStart;
      durationLen = el.size.value;
    }
    q = el.dataStart + el.size.value;
  }
  const ticks = (durationMs * 1_000_000) / scale;

  const out = head.slice(0, infoEnd);
  const view = new DataView(out.buffer);
  if (durationAt >= 0) {
    const current =
      durationLen === 8
        ? view.getFloat64(durationAt)
        : durationLen === 4
          ? view.getFloat32(durationAt)
          : Number.NaN;
    if (current > 0) return { bytes: new Uint8Array(0), consumed: 0 };
    if (durationLen === 8) view.setFloat64(durationAt, ticks);
    else if (durationLen === 4) view.setFloat32(durationAt, ticks);
    else return null;
    return { bytes: out, consumed: infoEnd };
  }

  // No Duration: append one to Info, which grows Info, the Segment if sized, and every SeekPosition past Info.
  const durationEl = new Uint8Array(11);
  durationEl.set([0x44, 0x89, 0x88]);
  new DataView(durationEl.buffer).setFloat64(3, ticks);
  const infoSize = encodeSize(info.size.value + 11, info.size.width);
  const grown = 11 + infoSize.length - info.size.width;

  const segSizeAt = seg.dataStart - seg.size.width;
  let segSize: Uint8Array = out.slice(segSizeAt, seg.dataStart);
  if (!seg.size.unknown) {
    segSize = encodeSize(seg.size.value + grown, seg.size.width);
    if (segSize.length !== seg.size.width) return null;
  }
  if (seekHead) shiftSeekPositions(out, seekHead, info.start - segData, grown);

  const infoSizeAt = info.dataStart - info.size.width;
  const bytes = concat([
    out.subarray(0, segSizeAt),
    segSize,
    out.subarray(seg.dataStart, infoSizeAt),
    infoSize,
    out.subarray(info.dataStart, infoEnd),
    durationEl,
  ]);
  return { bytes, consumed: infoEnd };
}

/** Moves, in place, every SeekPosition that points past Info by `grown` bytes. */
function shiftSeekPositions(
  buf: Uint8Array,
  seekHead: { start: number; end: number },
  infoOffset: number,
  grown: number,
) {
  for (let p = seekHead.start; p < seekHead.end; ) {
    const seek = readElement(buf, p);
    const seekEnd = seek.dataStart + seek.size.value;
    if (seek.id === ID_SEEK) {
      for (let q = seek.dataStart; q < seekEnd; ) {
        const el = readElement(buf, q);
        if (el.id === ID_SEEKPOSITION) {
          const pos = readUint(buf, el.dataStart, el.size.value);
          if (pos > infoOffset)
            writeUint(buf, el.dataStart, el.size.value, pos + grown);
        }
        q = el.dataStart + el.size.value;
      }
    }
    p = seekEnd;
  }
}

function readElement(buf: Uint8Array, at: number) {
  const id = readVint(buf, at, true);
  const size = readVint(buf, at + id.width, false);
  return {
    id: id.value,
    size,
    start: at,
    dataStart: at + id.width + size.width,
  };
}

/** An EBML variable-length integer; an id keeps its marker bit, a size drops it. */
function readVint(buf: Uint8Array, at: number, keepMarker: boolean): Vint {
  if (at >= buf.length) throw new RangeError("past the head");
  const first = buf[at];
  let width = 1;
  while (width <= 8 && !(first & (0x80 >> (width - 1)))) width++;
  if (width > 8 || at + width > buf.length) throw new RangeError("bad vint");
  const bits = keepMarker ? first : first & (0xff >> width);
  let value = bits;
  let allOnes = bits === 0xff >> width;
  for (let i = 1; i < width; i++) {
    value = value * 256 + buf[at + i];
    if (buf[at + i] !== 0xff) allOnes = false;
  }
  return { value, width, unknown: !keepMarker && allOnes };
}

function readUint(buf: Uint8Array, at: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[at + i];
  return v;
}

function writeUint(buf: Uint8Array, at: number, len: number, value: number) {
  if (value >= 256 ** len) throw new RangeError("does not fit");
  for (let i = len - 1; i >= 0; i--) {
    buf[at + i] = value % 256;
    value = Math.floor(value / 256);
  }
}

/** A size vint at least `width` bytes wide, wider only when the value needs it. */
function encodeSize(value: number, width: number): Uint8Array {
  let w = width;
  while (w < 8 && value >= 2 ** (7 * w) - 1) w++;
  const out = new Uint8Array(w);
  writeUint(out, 0, w, value);
  out[0] |= 0x80 >> (w - 1);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
