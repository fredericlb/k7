// peakPass.ts — the measuring half of a COLD module: read a file's true peak and write it into the
// param the module reads it from, immediately before the render. Without it a normaliser applies
// its default gain instead of normalising. Full rationale: docs/peakPass.md.

import { spawnSync } from "node:child_process";
import type { PluginDoc } from "@studio/song/project";

/** The param a MEASURING cold module receives its number in — one name, spelled once. */
export const PEAK_PARAM = "Peak";

/** The floor a measurement reports for silence, and the `Peak` param's minimum — one number, spelled once. */
export const PEAK_FLOOR_DB = -100;

/** What the engine's `--peak` prints. Only `peakDb` is read here; the rest is for a person. */
interface PeakReport {
  peak: number;
  peakDb: number;
  frames: number;
  channels: number;
  sampleRate: number;
}

/** One file's true peak in dBFS, measured by the engine and NOT off the sidecar — docs/peakPass.md. */
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

/** Does anything in this chain want a peak measured? Asked of the COMPILED plugins, docs/peakPass.md. */
export function needsPeak(plugins: readonly PluginDoc[]): boolean {
  return plugins.some((p) => PEAK_PARAM in (p.params ?? {}));
}

/** The same plugins with the measurement written in — a COPY, never a mutation; docs/peakPass.md. */
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
