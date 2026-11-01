// matroskaProbe.test.ts — a WebM read without ffprobe, as a browser records one: its facts in ffprobe's names,
// another container left to say "cannot say", and the pixel format a codec string states. docs/videoPrep.md.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Output,
  WebMOutputFormat,
} from "mediabunny";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MATROSKA_CONTAINER, pixFmtOf, probeMatroska } from "./matroskaProbe";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mkv-probe-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A WebM of `frames` VP9 packets at 25 fps, 640×360: muxed, never encoded, since only the container is read. */
async function webm(frames: number): Promise<string> {
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const video = new EncodedVideoPacketSource("vp9");
  output.addVideoTrack(video, { frameRate: 25 });
  await output.start();
  for (let i = 0; i < frames; i++)
    await video.add(
      new EncodedPacket(
        new Uint8Array(16),
        i ? "delta" : "key",
        i / 25,
        1 / 25,
      ),
      i
        ? undefined
        : {
            decoderConfig: {
              codec: "vp09.00.10.08",
              codedWidth: 640,
              codedHeight: 360,
            },
          },
    );
  await output.finalize();
  const path = join(dir, "take.webm");
  writeFileSync(path, new Uint8Array(output.target.buffer as ArrayBuffer));
  return path;
}

describe("a WebM read with no ffprobe", () => {
  it("says what it is in ffprobe's names", async () => {
    const facts = await probeMatroska(await webm(50));
    expect(facts).toMatchObject({
      codec: "vp9",
      width: 640,
      height: 360,
      pixFmt: "yuv420p",
      container: MATROSKA_CONTAINER,
    });
    expect(facts?.fps).toBeCloseTo(25, 0);
    expect(facts?.seconds).toBeCloseTo(2, 1);
  });

  it("cannot say for a file of another family", async () => {
    const other = join(dir, "x.mp4");
    writeFileSync(other, new Uint8Array(64));
    expect(await probeMatroska(other)).toBeUndefined();
  });
});

describe("the pixel format a codec string states", () => {
  it("reads the bit depth and the chroma of VP9 and AV1", () => {
    expect(pixFmtOf("vp09.00.10.08")).toBe("yuv420p");
    expect(pixFmtOf("vp09.02.10.10")).toBe("yuv420p10le");
    expect(pixFmtOf("vp09.01.10.08")).toBe("yuv444p");
    expect(pixFmtOf("av01.0.04M.10")).toBe("yuv420p10le");
    expect(pixFmtOf("av01.2.08M.12")).toBe("yuv422p12le");
  });

  it("assumes 8-bit 4:2:0 where the string says nothing", () => {
    expect(pixFmtOf("vp8")).toBe("yuv420p");
    expect(pixFmtOf(null)).toBe("yuv420p");
  });
});
