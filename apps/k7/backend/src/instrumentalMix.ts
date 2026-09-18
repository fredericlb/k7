// instrumentalMix.ts — an instrumental out of a song's stems: drums, bass and other summed by ffmpeg.
// Apart from the store so it runs in a test with nothing but ffmpeg — ../../docs/audio.md.
// What reads wrong: `normalize=0` is deliberate, since the stems add back up to the mix at their own levels.

import { spawn } from "node:child_process";

/** What an engine's instrumental chain leaves beside the master, when one ran. */
export const INSTRUMENTAL_FILE = "instrumental.wav";

/** The stems an instrumental is made of when no chain wrote one: everything but the voice. */
export const INSTRUMENTAL_STEMS = ["drums", "bass", "other"] as const;

/** ffmpeg's arguments for summing `inputs` into one lossless FLAC at `out`. */
export function mixArgs(inputs: readonly string[], out: string): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs.flatMap((input) => ["-i", input]),
    "-filter_complex",
    `amix=inputs=${inputs.length}:normalize=0`,
    "-c:a",
    "flac",
    out,
  ];
}

/** Run ffmpeg, rejecting with what it printed when it fails. */
export function runFfmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args);
    let err = "";
    ff.stderr.on("data", (d) => {
      err += d.toString();
    });
    ff.on("error", (e) =>
      reject(new Error(`ffmpeg could not start: ${e.message}`)),
    );
    ff.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `ffmpeg exited with ${code}: ${err.trim().slice(0, 300)}`,
            ),
          ),
    );
  });
}

/** Sum the stem files at `inputs` into a FLAC at `out`. */
export function mixStems(
  inputs: readonly string[],
  out: string,
): Promise<void> {
  return runFfmpeg(mixArgs(inputs, out));
}

/** One file into FLAC, for the instrumental a chain already summed — a WAV is twice the bytes to keep. */
export function toFlac(input: string, out: string): Promise<void> {
  return runFfmpeg([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    "-c:a",
    "flac",
    out,
  ]);
}
