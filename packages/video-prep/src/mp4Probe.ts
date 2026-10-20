// mp4Probe.ts — what an mp4 or a .mov IS, read from its boxes where there is no ffprobe: the phone.
// A reader would get wrong what it answers: ffprobe's own names (codec, pix_fmt, container), so the plan cannot tell who read it.
// Only the ISO family is read; any other container is `undefined`, "cannot say", which the caller turns back into a NoFfmpegError.

import { closeSync, openSync, readSync } from "node:fs";
import type { VideoFacts } from "./probe";

/** ffprobe's format name for every member of the family, .mov included. */
export const ISO_CONTAINER = "mov,mp4,m4a,3gp,3g2,mj2";

// An moov is a few hundred kilobytes for an hour of video; past this it is not one worth reading.
const MAX_MOOV = 64 << 20;

/** The sample entry's four-character code, as ffprobe names the codec. */
const CODECS: Record<string, string> = {
  avc1: "h264",
  avc3: "h264",
  hvc1: "hevc",
  hev1: "hevc",
  dvh1: "hevc",
  dvhe: "hevc",
  av01: "av1",
  vp09: "vp9",
  vp08: "vp8",
  apch: "prores",
  apcn: "prores",
  apcs: "prores",
  apco: "prores",
  ap4h: "prores",
  ap4x: "prores",
  mp4v: "mpeg4",
  jpeg: "mjpeg",
};

type Box = { kind: string; body: Buffer };

/** The children of a box body. */
function children(b: Buffer): Box[] {
  const out: Box[] = [];
  let i = 0;
  while (i + 8 <= b.length) {
    const size = b.readUInt32BE(i);
    let head = 8;
    let len = size;
    if (size === 1) {
      if (i + 16 > b.length) break;
      head = 16;
      len = Number(b.readBigUInt64BE(i + 8));
    } else if (size === 0) len = b.length - i;
    if (len < head || i + len > b.length) break;
    out.push({
      kind: b.toString("latin1", i + 4, i + 8),
      body: b.subarray(i + head, i + len),
    });
    i += len;
  }
  return out;
}

const child = (b: Buffer | undefined, kind: string): Buffer | undefined =>
  b && children(b).find((c) => c.kind === kind)?.body;

/** A full box's timescale and duration, after its version, flags and two dates of 4 or 8 bytes. */
function scaleAndLength(b: Buffer): { scale: number; length: number } {
  return b[0] === 1
    ? { scale: b.readUInt32BE(20), length: Number(b.readBigUInt64BE(24)) }
    : { scale: b.readUInt32BE(12), length: b.readUInt32BE(16) };
}

/** ffprobe's pix_fmt for a chroma format (0 grey, 1 4:2:0, 2 4:2:2, 3 4:4:4) at a bit depth. */
function pixFmt(chroma: number, depth: number): string {
  const base = ["gray", "yuv420p", "yuv422p", "yuv444p"][chroma] ?? "yuv420p";
  return depth > 8 ? `${base}${depth}le` : base;
}

/** The pixel format from the codec's configuration box, as far as it says. */
function pixFmtOf(config: Buffer): string {
  const avcC = child(config, "avcC");
  if (avcC && avcC.length > 1) {
    const profile = avcC[1];
    // The High profiles state chroma and depth after the parameter sets; reached by skipping them.
    if ([100, 110, 122, 144].includes(profile)) {
      let i = 5;
      const sps = avcC[i++] & 0x1f;
      for (let n = 0; n < sps && i + 2 <= avcC.length; n++)
        i += 2 + avcC.readUInt16BE(i);
      const pps = avcC[i++] ?? 0;
      for (let n = 0; n < pps && i + 2 <= avcC.length; n++)
        i += 2 + avcC.readUInt16BE(i);
      if (i + 2 <= avcC.length)
        return pixFmt(avcC[i] & 3, (avcC[i + 1] & 7) + 8);
      if (profile === 110) return pixFmt(1, 10);
      if (profile === 122) return pixFmt(2, 10);
      if (profile === 144) return pixFmt(3, 10);
    }
    return pixFmt(1, 8);
  }
  const hvcC = child(config, "hvcC");
  if (hvcC && hvcC.length > 17) return pixFmt(hvcC[16] & 3, (hvcC[17] & 7) + 8);
  const av1C = child(config, "av1C");
  if (av1C && av1C.length > 2) {
    const b = av1C[2];
    const depth = b & 0x40 ? (b & 0x20 ? 12 : 10) : 8;
    if (b & 0x10) return pixFmt(0, depth);
    const chroma = b & 0x08 ? (b & 0x04 ? 1 : 2) : 3;
    return pixFmt(chroma, depth);
  }
  const vpcC = child(config, "vpcC");
  if (vpcC && vpcC.length > 6) {
    const cs = (vpcC[6] >> 1) & 7;
    return pixFmt(cs <= 1 ? 1 : cs === 2 ? 2 : 3, vpcC[6] >> 4);
  }
  return "";
}

/** The facts of the first video track of an `moov` body, or null when it has none. */
function fromMoov(moov: Buffer): VideoFacts | null {
  const mvhd = child(moov, "mvhd");
  const movie = mvhd ? scaleAndLength(mvhd) : { scale: 1, length: 0 };
  for (const trak of children(moov)) {
    if (trak.kind !== "trak") continue;
    const mdia = child(trak.body, "mdia");
    const hdlr = child(mdia, "hdlr");
    if (!mdia || hdlr?.toString("latin1", 8, 12) !== "vide") continue;
    const mdhd = child(mdia, "mdhd");
    const stbl = child(child(mdia, "minf"), "stbl");
    const stsd = child(stbl, "stsd");
    // The sample entry: after stsd's version, flags and count, one box whose body is the visual entry.
    const entry =
      stsd && stsd.length >= 16 ? children(stsd.subarray(8))[0] : undefined;
    if (!entry || entry.body.length < 78) return null;
    const fourcc = entry.kind;
    const codec = CODECS[fourcc] ?? fourcc.trim().toLowerCase();
    // ProRes states nothing in a box: 4444 is 4:4:4, the rest 4:2:2, 10-bit as ffprobe reports them.
    const prores =
      codec === "prores"
        ? fourcc === "ap4h" || fourcc === "ap4x"
          ? "yuv444p10le"
          : "yuv422p10le"
        : "";
    let fps = 0;
    const stts = child(stbl, "stts");
    if (mdhd && stts && stts.length >= 8) {
      const { scale } = scaleAndLength(mdhd);
      let frames = 0;
      let ticks = 0;
      const n = stts.readUInt32BE(4);
      for (let e = 0; e < n && 16 + e * 8 <= stts.length; e++) {
        const count = stts.readUInt32BE(8 + e * 8);
        frames += count;
        ticks += count * stts.readUInt32BE(12 + e * 8);
      }
      fps = ticks ? (frames * scale) / ticks : 0;
    }
    return {
      codec,
      width: entry.body.readUInt16BE(24),
      height: entry.body.readUInt16BE(26),
      pixFmt: prores || pixFmtOf(entry.body.subarray(78)),
      fps,
      seconds: movie.scale ? movie.length / movie.scale : 0,
      container: ISO_CONTAINER,
    };
  }
  return null;
}

/** The facts of `source`'s first video track, null when it has none, `undefined` when it is not an mp4 or a .mov. */
export function probeMp4(source: string): VideoFacts | null | undefined {
  const fd = openSync(source, "r");
  try {
    const head = Buffer.alloc(16);
    let at = 0;
    for (let first = true; ; first = false) {
      if (readSync(fd, head, 0, 16, at) < 8) return undefined;
      const kind = head.toString("latin1", 4, 8);
      if (first && kind !== "ftyp") return undefined;
      let len = head.readUInt32BE(0);
      let skip = 8;
      if (len === 1) {
        len = Number(head.readBigUInt64BE(8));
        skip = 16;
      }
      if (len < skip) return undefined;
      if (kind === "moov") {
        if (len - skip > MAX_MOOV) return undefined;
        const body = Buffer.alloc(len - skip);
        if (readSync(fd, body, 0, body.length, at + skip) < body.length)
          return undefined;
        return fromMoov(body);
      }
      at += len;
    }
  } finally {
    closeSync(fd);
  }
}
