// peakPass.ts — the measuring half of a COLD module: read a file's true peak and write it into the
// param the module reads it from, immediately before the render. This is the pass coldModules.md and
// processChain.md both recorded as missing, and without which a normaliser applies its default gain
// instead of normalising. Full rationale: docs/peakPass.md.

import { spawnSync } from "node:child_process";
import type { PluginDoc } from "@studio/song/project";

/**
 * The param a MEASURING cold module receives its number in.
 *
 * One name, spelled once. `@studio/dsp`'s `normalize()` declares it, the médiathèque's module.yaml
 * authors it, and this pass fills it — three places that have to agree, so none of them guesses.
 */
export const PEAK_PARAM = "Peak";

/** The floor a measurement reports for silence, and the `Peak` param's own minimum. */
export const PEAK_FLOOR_DB = -100;

/** What the engine's `--peak` prints. Only `peakDb` is read here; the rest is for a person. */
interface PeakReport {
  peak: number;
  peakDb: number;
  frames: number;
  channels: number;
  sampleRate: number;
}

/**
 * One file's true peak, in dBFS — the loudest sample on ANY channel.
 *
 * Measured by the engine, for the reason every decode is: it owns the formats. Deliberately NOT
 * taken from the `{file}.cache` waveform sidecar, which is the tempting shortcut and is wrong — that
 * envelope is a mono SUM at four decimals. Measured on fabricated files, it reads 6 dB low when the
 * peak sits on one channel of a stereo pair, and reports SILENCE for two channels in anti-phase, 94 dB
 * out. Normalising from it would have asked for the +99 dB the module's clamp exists to survive.
 */
export function measureFilePeakDb(engineBin: string, source: string): number {
  const r = spawnSync(engineBin, ["--peak", source], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (r.status !== 0)
    throw new Error(
      `could not measure the peak of ${source}${r.error ? `: ${r.error.message}` : ""}`,
    );
  const line = (r.stdout ?? "").trim().split("\n").pop() ?? "";
  let report: PeakReport;
  try {
    report = JSON.parse(line) as PeakReport;
  } catch {
    throw new Error(
      `the engine's peak for ${source} was not readable: ${line}`,
    );
  }
  if (typeof report.peakDb !== "number" || Number.isNaN(report.peakDb))
    throw new Error(`the engine reported no peak for ${source}`);
  return report.peakDb;
}

/**
 * Does anything in this chain want a peak measured?
 *
 * Asked of the compiled plugins rather than of the modules, because that is where the pass can act:
 * the compiler has already folded a node's authored params onto the module's, so a `Peak` present
 * here is one the engine will read. A chain with no such step must cost no decode at all — most
 * bounces are not normalisations.
 */
export function needsPeak(plugins: readonly PluginDoc[]): boolean {
  return plugins.some((p) => PEAK_PARAM in (p.params ?? {}));
}

/**
 * The same plugins with the measurement written in.
 *
 * A copy, never a mutation: the resolved chain is measured once and rendered over SEVERAL sources
 * (`track process` treats every file a lane's clips play), and each of those has its own peak. Writing
 * back into the shared chain would give the second file the first one's gain — quietly, and only on
 * the files after the first, which is the shape of bug that survives a demo.
 *
 * Every plugin declaring the param gets it. Two normalisers in one chain is a strange thing to
 * author, but if somebody does, both are measuring the same input file and both are right.
 */
export function withMeasuredPeak(
  plugins: readonly PluginDoc[],
  peakDb: number,
): PluginDoc[] {
  return plugins.map((p) =>
    PEAK_PARAM in (p.params ?? {})
      ? { ...p, params: { ...p.params, [PEAK_PARAM]: peakDb } }
      : p,
  );
}
