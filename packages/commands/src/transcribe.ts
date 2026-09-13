// transcribe.ts — `track transcribe`: whisper listens to the video a picture lane places, and the
// transcript lands as the NEW lane's `content:`. The CLI is whoever the machine has — `whisper`
// (openai-whisper) or `whisper-cli` (whisper.cpp, which needs STUDIO_WHISPER_MODEL to name a ggml
// model) — and timings are the SOURCE's own seconds, written as SRT so the text stays usable
// outside this app. See docs/verbs.md.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

/** One spoken segment, in the SOURCE video's own seconds. */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

// One cue's timing line — `00:01:02,480 --> 00:01:05,120`. whisper.cpp writes `.` where
// openai-whisper writes `,`, and both are read, because refusing a dialect is not ours to do.
const SRT_TIME =
  /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{1,3})/;

const secondsOf = (h: string, m: string, s: string, ms: string): number =>
  Number(h) * 3600 +
  Number(m) * 60 +
  Number(s) +
  Number(ms.padEnd(3, "0")) / 1000;

/** The segments an SRT text holds, parsed defensively: a cue is its TIMING line plus what follows,
 *  so a missing or garbled index never shifts the text. Empty cues are dropped. */
export function parseSrt(text: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const at = lines.findIndex((l) => SRT_TIME.test(l));
    if (at < 0) continue;
    const hit = SRT_TIME.exec(lines[at]);
    if (!hit) continue;
    const content = lines
      .slice(at + 1)
      .join(" ")
      .trim();
    if (!content) continue;
    out.push({
      start: secondsOf(hit[1], hit[2], hit[3], hit[4]),
      end: secondsOf(hit[5], hit[6], hit[7], hit[8]),
      text: content,
    });
  }
  return out;
}

const srtTime = (t: number): string => {
  const ms = Math.max(0, Math.round(t * 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    `${two(Math.floor(ms / 3600000))}:` +
    `${two(Math.floor((ms % 3600000) / 60000))}:` +
    `${two(Math.floor((ms % 60000) / 1000))},` +
    `${String(ms % 1000).padStart(3, "0")}`
  );
};

/** The content a transcript lane carries — valid SRT, so the text is one copy away from a subtitle file. */
export function srtOf(segments: TranscriptSegment[]): string {
  // Each block ends with its own newline, joined by one more: the blank line SRT puts between cues,
  // and a single trailing newline at the end of the file.
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`,
    )
    .join("\n");
}

const stderrTail = (err: Buffer | string | undefined): string =>
  String(err ?? "")
    .trim()
    .split("\n")
    .slice(-3)
    .join(" · ");

/** The audio whisper needs, decoded by ffmpeg — which this machine has, renders being made with it. */
export function extractAudio(video: string, wav: string): void {
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      video,
      "-vn", // no picture: it is the sound whisper listens to
      "-ac",
      "1",
      "-ar",
      "16000",
      wav,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (r.status !== 0 || !existsSync(wav))
    throw new Error(
      `ffmpeg could not read ${basename(video)}: ${stderrTail(r.stderr)}`,
    );
}

/** One whisper CLI's dialect: how it is invoked, and where its SRT lands. */
interface WhisperCli {
  args: (wav: string, outDir: string, model?: string) => string[];
  srt: (wav: string, outDir: string) => string;
}

const CLIS: Record<string, WhisperCli> = {
  // openai-whisper names its output after the input's stem and manages its own model downloads.
  whisper: {
    args: (wav, outDir, model) => [
      wav,
      "--output_format",
      "srt",
      "--output_dir",
      outDir,
      ...(model ? ["--model", model] : []),
    ],
    srt: (wav, outDir) =>
      join(outDir, `${basename(wav).replace(/\.wav$/i, "")}.srt`),
  },
  // whisper.cpp wants the model spelled out — STUDIO_WHISPER_MODEL is a path to a ggml file.
  "whisper-cli": {
    args: (wav, outDir, model) => {
      if (!model)
        throw new Error(
          "whisper-cli needs a model — set STUDIO_WHISPER_MODEL to a ggml file (e.g. models/ggml-base.bin)",
        );
      return [
        "-f",
        wav,
        "-m",
        model,
        "-osrt",
        "-of",
        join(outDir, "transcribe"),
      ];
    },
    srt: (_wav, outDir) => join(outDir, "transcribe.srt"),
  },
};

type Attempt =
  | { ok: true; srt: string }
  | { ok: false; missing: boolean; error?: string };

async function attempt(
  bin: string,
  cli: WhisperCli,
  wav: string,
  outDir: string,
): Promise<Attempt> {
  let args: string[];
  try {
    args = cli.args(wav, outDir, process.env.STUDIO_WHISPER_MODEL);
  } catch (e) {
    // A refusal the adapter itself raised — the tool is pointless without what it asked for.
    return { ok: false, missing: false, error: (e as Error).message };
  }
  const srtPath = cli.srt(wav, outDir);
  return new Promise((res) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d: Buffer) => {
      err = `${err}${String(d)}`.slice(-4000);
    });
    child.on("error", (e: NodeJS.ErrnoException) =>
      res(
        e.code === "ENOENT"
          ? { ok: false, missing: true }
          : { ok: false, missing: false, error: e.message },
      ),
    );
    child.on("close", (code) =>
      code === 0 && existsSync(srtPath)
        ? res({ ok: true, srt: srtPath })
        : res({
            ok: false,
            missing: false,
            error: stderrTail(err) || `exit code ${code ?? "?"}`,
          }),
    );
  });
}

/** Transcribe one 16 kHz mono wav with whoever the machine has, answering the segments.
 *  A binary that is not there is stepped over; one that RAN and failed IS the error, said as it
 *  said it — retrying with another dialect would double a model download nobody asked for. */
export async function transcribeAudio(
  wav: string,
  outDir: string,
): Promise<TranscriptSegment[]> {
  const notInstalled: string[] = [];
  for (const [bin, cli] of Object.entries(CLIS)) {
    const r = await attempt(bin, cli, wav, outDir);
    if (r.ok) return parseSrt(readFileSync(r.srt, "utf8"));
    if (r.missing) notInstalled.push(bin);
    else
      throw new Error(`${bin} failed: ${r.error ?? "it wrote no subtitles"}`);
  }
  throw new Error(
    `no whisper on this machine (tried ${notInstalled.join(", ")}) — install one: ` +
      `pip install openai-whisper gives \`whisper\`; whisper.cpp gives \`whisper-cli\``,
  );
}
