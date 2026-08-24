// separateWorker.ts — the half of a separation that burns a core for minutes: decode the input
// with ffmpeg, run the model window by window, fold the results, write four 24-bit WAVs. Runs in a
// worker_thread and talks to separate.ts by postMessage; nothing here touches Express.
// See docs/stemSplit.md.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { MASTER_FILE } from "@studio/song-schema/stems";
import { chooseDmlAdapter } from "./dmlAdapters";
import {
  CHANNELS,
  deinterleave,
  OverlapAdd,
  peakOf,
  SAMPLE_RATE,
  SEGMENT,
  STEMS,
  wavPcm24,
  windowStarts,
} from "./separateAudio";

export interface SeparateInput {
  source: string; // absolute path to the mix
  model: string; // absolute path to the .onnx
  outDir: string; // where the four stems are written
  providers?: string[]; // execution providers to try, in order; the platform's own when absent
}

export interface WorkerProgress {
  phase: string;
  percent: number | null;
  line?: string;
}

const say = (p: WorkerProgress) => parentPort?.postMessage({ progress: p });

/** Decode into the exact shape the model wants, failing HARD unlike every other ffmpeg call here — docs/stemSplit.md. */
function decode(source: string): Promise<Float32Array[]> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      source,
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      String(CHANNELS),
      "-",
    ]);
    const chunks: Buffer[] = [];
    let err = "";
    ff.stdout.on("data", (d: Buffer) => chunks.push(d));
    ff.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-2048);
    });
    ff.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        new Error(
          e.code === "ENOENT"
            ? "ffmpeg is not installed — stem separation decodes its input with it, and " +
                "unlike a transcode there is no lesser result to fall back to"
            : e.message,
        ),
      ),
    );
    ff.on("close", (code) => {
      if (code !== 0)
        return reject(
          new Error(`ffmpeg could not decode ${source}: ${err.trim()}`),
        );
      const raw = Buffer.concat(chunks);
      // A Buffer's bytes are not necessarily 4-aligned in its pool, so copy rather than view.
      const pcm = new Float32Array(raw.byteLength / 4);
      for (let i = 0; i < pcm.length; i++) pcm[i] = raw.readFloatLE(i * 4);
      resolve(deinterleave(pcm));
    });
  });
}

/** The source's own rate, since a stem is only subtractable at the rate the RECORD plays — docs/stemSplit.md. */
function probeRate(source: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=sample_rate",
      "-of",
      "csv=p=0",
      source,
    ]);
    let out = "";
    p.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    p.on("error", () => resolve(undefined));
    p.on("close", () => {
      const n = Number.parseInt(out.trim(), 10);
      resolve(Number.isFinite(n) && n > 0 ? n : undefined);
    });
  });
}

/** Write one stem AT the record's rate, resampling through ffmpeg when the model's differs. */
function writeStem(
  path: string,
  chans: Float32Array[],
  to: number,
): Promise<void> {
  if (to === SAMPLE_RATE) {
    writeFileSync(path, wavPcm24(chans));
    return Promise.resolve();
  }
  const frames = chans[0]?.length ?? 0;
  const inter = new Float32Array(frames * chans.length);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < chans.length; c++)
      inter[i * chans.length + c] = chans[c][i];
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "f32le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      String(chans.length),
      "-i",
      "-",
      "-ar",
      String(to),
      "-c:a",
      "pcm_s24le",
      "-y",
      path,
    ]);
    let err = "";
    ff.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-2048);
    });
    ff.on("error", reject);
    ff.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg could not write ${path}: ${err.trim()}`)),
    );
    ff.stdin.end(Buffer.from(inter.buffer, inter.byteOffset, inter.byteLength));
  });
}

/** The record beside its stems, from the same decoder — what makes the subtraction cancel; docs/stemSplit.md. */
function writeMaster(
  source: string,
  path: string,
  rate: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      source,
      "-ar",
      String(rate),
      "-ac",
      String(CHANNELS),
      "-c:a",
      "pcm_s24le",
      "-y",
      path,
    ]);
    let err = "";
    ff.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-2048);
    });
    ff.on("error", reject);
    ff.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg could not write ${path}: ${err.trim()}`)),
    );
  });
}

/** The slice of ONNX Runtime this file uses, declared rather than imported — see docs/stemSplit.md. */
const ORT_MODULE = "onnxruntime-node";

interface OrtTensor {
  data: unknown;
}
type OrtProvider = string | { name: string; deviceId?: number };
interface Ort {
  InferenceSession: {
    create(
      path: string,
      opts: { executionProviders: OrtProvider[] },
    ): Promise<{
      run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
    }>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
}

/** CPU last and always: it is the one that cannot be unavailable, and the only one on a Mac. */
export const defaultProviders = (): string[] => {
  // The order below is a guess about the hardware; a machine that measured otherwise says so here.
  const asked = process.env.STUDIO_ONNX_PROVIDERS?.trim();
  if (asked) return asked.split(/[,\s]+/).filter(Boolean);
  return process.platform === "win32" ? ["dml", "cpu"] : ["cpu"];
};

/** The session, on the first execution provider that builds, and which one won is LOGGED — docs/stemSplit.md. */
async function session(
  model: string,
  wanted: string[],
): Promise<{ run: RunFn; provider: string; adapter: string }> {
  let ort: Ort;
  try {
    // Imported by NAME through a variable, so the native package need not resolve and esbuild leaves it.
    ort = (await import(/* @vite-ignore */ ORT_MODULE)) as Ort;
  } catch (e) {
    throw new Error(
      "onnxruntime-node is not installed — run `npm install` at the repo root. " +
        `(${(e as Error).message})`,
    );
  }
  const failures: string[] = [];
  for (const ep of wanted) {
    // An integrated GPU is not asked at all, and the discrete one is NAMED — docs/stemSplit.md.
    let asked: OrtProvider = ep;
    let adapter = "";
    if (ep === "dml") {
      const choice = chooseDmlAdapter();
      if (choice.kind === "integrated-only") {
        failures.push(
          `${ep}: ${choice.name} is integrated, so this machine has no GPU for it`,
        );
        continue;
      }
      if (choice.kind === "adapter") {
        asked = { name: "dml", deviceId: choice.deviceId };
        adapter = ` (${choice.name}, deviceId ${choice.deviceId})`;
      }
    }
    try {
      const s = await ort.InferenceSession.create(model, {
        executionProviders: [asked],
      });
      return {
        provider: ep,
        adapter,
        run: async (mix) => {
          const out = await s.run({
            mix: new ort.Tensor("float32", mix, [1, CHANNELS, SEGMENT]),
          });
          const t = out.stems ?? Object.values(out)[0];
          return t.data as Float32Array;
        },
      };
    } catch (e) {
      failures.push(`${ep}: ${(e as Error).message}`);
    }
  }
  throw new Error(
    `no ONNX execution provider would load ${model} — ${failures.join("; ")}`,
  );
}

type RunFn = (mix: Float32Array) => Promise<Float32Array>;

/** One window's worth of the mix, zero-padded when the file is shorter than a window. */
function windowOf(chans: Float32Array[], at: number): Float32Array {
  const mix = new Float32Array(CHANNELS * SEGMENT);
  for (let c = 0; c < CHANNELS; c++) {
    const src = chans[c];
    const n = Math.min(SEGMENT, Math.max(0, src.length - at));
    for (let i = 0; i < n; i++) mix[c * SEGMENT + i] = src[at + i];
  }
  return mix;
}

export async function separate({
  source,
  model,
  outDir,
  providers,
}: SeparateInput): Promise<string[]> {
  say({ phase: "decoding", percent: null });
  const chans = await decode(source);
  const length = chans[0]?.length ?? 0;
  if (!length) throw new Error(`${source} decoded to no audio`);

  say({ phase: "loading model", percent: null });
  let { run, provider, adapter } = await session(
    model,
    providers?.length ? providers : defaultProviders(),
  );
  say({
    phase: "separating",
    percent: 0,
    line: `execution provider: ${provider}${adapter}`,
  });

  const starts = windowStarts(length);
  const oa = new OverlapAdd(length);
  let retried = false;
  for (const [i, at] of starts.entries()) {
    let stems: Float32Array | null = null;
    while (stems === null) {
      try {
        stems = await run(windowOf(chans, at));
      } catch (e) {
        if (provider === "cpu") throw e;
        // A device lost kills the SESSION rather than the GPU, so the first answer is a fresh one — docs/stemSplit.md.
        const next = retried ? ["cpu"] : [provider];
        if (retried) parentPort?.postMessage({ lostProvider: provider });
        say({
          phase: "separating",
          percent: Math.round((i / starts.length) * 100),
          line:
            `${provider} failed at window ${i + 1}/${starts.length}, ` +
            `${retried ? "finishing on cpu" : "retrying on a fresh session"} — ` +
            (e as Error).message.split("\n")[0],
        });
        retried = true;
        ({ run, provider, adapter } = await session(model, next));
      }
    }
    // `[1, 4, 2, SEGMENT]`, flat, with the stem index outermost — STEMS is that order, not a guess.
    for (let s = 0; s < STEMS.length; s++)
      for (let c = 0; c < CHANNELS; c++) {
        const off = (s * CHANNELS + c) * SEGMENT;
        oa.add(at, s, c, stems.subarray(off, off + SEGMENT));
      }
    oa.countWindow(at);
    say({
      phase: "separating",
      percent: Math.round(((i + 1) / starts.length) * 100),
    });
  }

  say({ phase: "writing", percent: 100 });
  mkdirSync(outDir, { recursive: true });
  // The model works at 44.1 kHz; a stem that stays there cannot CANCEL against a record that does not.
  const rate = (await probeRate(source)) ?? SAMPLE_RATE;
  if (rate !== SAMPLE_RATE)
    say({
      phase: "writing",
      percent: 100,
      line: `writing at ${rate} Hz, the record's own — the model works at ${SAMPLE_RATE}`,
    });
  const out: string[] = [];
  for (const [s, name] of STEMS.entries()) {
    const path = join(outDir, `${name}.wav`);
    const chans = oa.finish(s);
    // An overshoot is CLAMPED and SAID: the other way to find out is a click (docs/stemSplit.md).
    const peak = peakOf(chans);
    if (peak > 1)
      say({
        phase: "writing",
        percent: 100,
        line: `${name}: peak ${peak.toFixed(3)} — clamped to full scale`,
      });
    await writeStem(path, chans, rate);
    out.push(path);
  }
  // Last, so a folder holding it holds everything: `stemsComplete` is what reads that.
  const master = join(outDir, MASTER_FILE);
  await writeMaster(source, master, rate);
  // RETURNED, not merely written: over `/process` the caller collects what this list names — docs/stemSplit.md.
  out.push(master);
  return out;
}

// Worker entry. Guarded so the module can be imported by a test without running anything.
if (parentPort && workerData) {
  separate(workerData as SeparateInput)
    .then((files) => parentPort?.postMessage({ done: files }))
    .catch((e: Error) => parentPort?.postMessage({ failed: e.message }));
}
