// The transcode queue is bounded: past MAX_TRANSCODES running and MAX_WAITING queued, a FLAC is refused.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "transcode-queue-"));
const fake = join(dir, "ffmpeg");
// A stand-in ffmpeg that takes its time, then writes its last argument.
writeFileSync(
  fake,
  `#!/usr/bin/env node
setTimeout(() => require("fs").writeFileSync(process.argv.at(-1), "mp3"), 150);
`,
);
chmodSync(fake, 0o755);
process.env.FFMPEG_BIN = fake;

const {
  ensureMp3,
  MAX_TRANSCODES,
  MAX_WAITING,
  TranscodeBusyError,
  transcodeLoad,
} = await import("./transcode.ts");

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FFMPEG_BIN;
});

describe.skipIf(process.platform === "win32")("the transcode queue", () => {
  it("runs MAX_TRANSCODES, queues MAX_WAITING, and refuses the next", async () => {
    const flacs = Array.from(
      { length: MAX_TRANSCODES + MAX_WAITING + 1 },
      (_, i) => {
        const f = join(dir, `t${i}.flac`);
        writeFileSync(f, "flac");
        return f;
      },
    );
    const last = flacs.pop() as string;
    const all = flacs.map((f) => ensureMp3(f));
    await new Promise((ok) => setTimeout(ok, 0));
    expect(transcodeLoad()).toEqual({
      active: MAX_TRANSCODES,
      waiting: MAX_WAITING,
    });
    await expect(ensureMp3(last)).rejects.toThrow(TranscodeBusyError);
    await Promise.all(all);
    expect(transcodeLoad()).toEqual({ active: 0, waiting: 0 });
  });
});
