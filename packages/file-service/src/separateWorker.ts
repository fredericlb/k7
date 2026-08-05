// separateWorker.ts — the half of a separation that burns a core for minutes: decode the input
// with ffmpeg, run the model window by window, fold the results, write four WAVs. Runs in a
// worker_thread and talks to separate.ts by postMessage; nothing here touches Express.
// See docs/stemSplit.md.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import {
  CHANNELS,
  deinterleave,
  OverlapAdd,
  SAMPLE_RATE,
  SEGMENT,
  STEMS,
  wavFloat32,
  windowStarts,
} from "./separateAudio";

export interface SeparateInput {
  source: string; // absolute path to the mix
  model: string; // absolute path to the .onnx
  outDir: string; // where the four stems are written
}

export interface WorkerProgress {
  phase: string;
  percent: number | null;
  line?: string;
}

const say = (p: WorkerProgress) => parentPort?.postMessage({ progress: p });

/**
 * Decode anything ffmpeg reads into the exact shape the model wants: 44.1 kHz, stereo,
 * 32-bit float. Resampling and mono-to-stereo are ffmpeg's job rather than ours because it
 * already does both correctly, and the model's input length is fixed — arriving at 48 kHz
 * would not be a quality question, it would be the wrong number of samples.
 *
 * NOT best-effort, unlike every other ffmpeg call in this repo. A missing ffmpeg there costs a
 * FORMAT and the wav survives; here it costs the only thing the request asked for. So it fails
 * with its own sentence, the way a missing engine binary does.
 */
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
        return reject(new Error(`ffmpeg could not decode ${source}: ${err.trim()}`));
      const raw = Buffer.concat(chunks);
      // A Buffer's bytes are not necessarily 4-aligned in its pool, so copy rather than view.
      const pcm = new Float32Array(raw.byteLength / 4);
      for (let i = 0; i < pcm.length; i++) pcm[i] = raw.readFloatLE(i * 4);
      resolve(deinterleave(pcm));
    });
  });
}

/**
 * The slice of ONNX Runtime this file uses, written down rather than imported as a type.
 *
 * It is four members wide, and naming them is the point: this is the contract the separation
 * depends on, so a version of ORT that changed it fails against a declaration somebody can
 * read instead of somewhere deep in an inference loop. It also keeps `tsc --noEmit` honest on
 * a machine that has not installed a 300 MB native package yet.
 */
const ORT_MODULE = "onnxruntime-node";

interface OrtTensor {
  data: unknown;
}
interface Ort {
  InferenceSession: {
    create(
      path: string,
      opts: { executionProviders: string[] },
    ): Promise<{ run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>> }>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
}

/**
 * The session, on the best execution provider this machine will give us.
 *
 * Asked for in order and taken on the first that builds: ORT throws at session creation when a
 * provider is unavailable, so this is the only way to find out. Which one won is LOGGED — the
 * difference between DirectML and CPU here is minutes per song, and a silent fall back to CPU
 * looks exactly like a slow machine.
 */
async function session(model: string): Promise<{ run: RunFn; provider: string }> {
  let ort: Ort;
  try {
    // Imported by NAME through a variable, and typed against the four-member interface above
    // rather than against the package. Two reasons, and the second is the load-bearing one:
    // the dependency is native, so this module has to be importable — by a test, by a tsc run
    // on a machine that has not installed it — without it resolving; and esbuild must leave
    // the specifier alone for `external` to work (see build-engine.mjs).
    ort = (await import(/* @vite-ignore */ ORT_MODULE)) as Ort;
  } catch (e) {
    throw new Error(
      "onnxruntime-node is not installed — run `npm install` at the repo root. " +
        `(${(e as Error).message})`,
    );
  }
  // CPU last and always: it is the one that cannot be unavailable.
  const wanted = process.platform === "win32" ? ["dml", "cpu"] : ["cpu"];
  const failures: string[] = [];
  for (const ep of wanted) {
    try {
      const s = await ort.InferenceSession.create(model, {
        executionProviders: [ep],
      });
      return {
        provider: ep,
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
  throw new Error(`no ONNX execution provider would load ${model} — ${failures.join("; ")}`);
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

export async function separate({ source, model, outDir }: SeparateInput): Promise<string[]> {
  say({ phase: "decoding", percent: null });
  const chans = await decode(source);
  const length = chans[0]?.length ?? 0;
  if (!length) throw new Error(`${source} decoded to no audio`);

  say({ phase: "loading model", percent: null });
  const { run, provider } = await session(model);
  say({ phase: "separating", percent: 0, line: `execution provider: ${provider}` });

  const starts = windowStarts(length);
  const oa = new OverlapAdd(length);
  for (const [i, at] of starts.entries()) {
    const stems = await run(windowOf(chans, at));
    // `[1, 4, 2, SEGMENT]`, flat. The stem index is the outer one — see STEMS for why the
    // order is knowledge and not a guess.
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
  return STEMS.map((name, s) => {
    const path = join(outDir, `${name}.wav`);
    writeFileSync(path, wavFloat32(oa.finish(s)));
    return path;
  });
}

// Worker entry. Guarded so the module can be imported by a test without running anything.
if (parentPort && workerData) {
  separate(workerData as SeparateInput)
    .then((files) => parentPort?.postMessage({ done: files }))
    .catch((e: Error) => parentPort?.postMessage({ failed: e.message }));
}
