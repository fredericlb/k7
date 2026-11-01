// matroskaProbe.ts — what a WebM or an mkv IS, read with mediabunny's demuxer where there is no ffprobe: a browser's
// own recordings are WebM, which the box reader beside it cannot open. It answers in ffprobe's names, as mp4Probe.ts
// does, so the plan cannot tell who read it. Any other container is `undefined`, "cannot say". See docs/videoPrep.md.

import { FilePathSource, Input, MATROSKA, WEBM } from "mediabunny";
import type { VideoFacts } from "./probe";

/** ffprobe's format name for the family, WebM included. */
export const MATROSKA_CONTAINER = "matroska,webm";

/** mediabunny's codec names, as ffprobe spells them. */
const CODECS: Record<string, string> = {
  avc: "h264",
  hevc: "hevc",
  vp8: "vp8",
  vp9: "vp9",
  av1: "av1",
};

/** How many packets the frame rate is averaged over: enough to steady it, few enough to read at once. */
const RATE_PACKETS = 120;

/** The chroma each profile carries, for the two codec strings that state it; any other is 4:2:0. */
const CHROMA: Record<string, Record<string, string>> = {
  vp09: { "01": "444", "03": "444" },
  av01: { "1": "444", "2": "422" },
};

/** ffprobe's pixel format from a WebCodecs codec string — `vp09.PP.LL.DD`, `av01.P.LLT.DD` — 8-bit 4:2:0 when it says nothing. */
export function pixFmtOf(param: string | null): string {
  const [kind = "", profile = "", , depth] = (param ?? "").split(".");
  const stated = kind === "vp09" || kind === "av01";
  const bits = stated ? Number(depth) || 8 : 8;
  const chroma = (stated && CHROMA[kind]?.[profile]) || "420";
  return bits > 8 ? `yuv${chroma}p${bits}le` : `yuv${chroma}p`;
}

/** The facts of `source`'s first video stream; null with none; undefined when it is not a Matroska file. */
export async function probeMatroska(
  source: string,
): Promise<Omit<VideoFacts, "noFfmpeg"> | null | undefined> {
  const input = new Input({
    source: new FilePathSource(source),
    formats: [WEBM, MATROSKA],
  });
  try {
    try {
      await input.getFormat();
    } catch {
      return undefined;
    }
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const codec = await track.getCodec();
    const rotation = await track.getRotation();
    return {
      codec: codec ? (CODECS[codec] ?? codec) : "",
      width: await track.getCodedWidth(),
      height: await track.getCodedHeight(),
      pixFmt: pixFmtOf(await track.getCodecParameterString()),
      fps: (await track.computePacketStats(RATE_PACKETS)).averagePacketRate,
      seconds: await input.computeDuration(),
      container: MATROSKA_CONTAINER,
      ...(rotation ? { rotation } : {}),
    };
  } finally {
    input.dispose();
  }
}
