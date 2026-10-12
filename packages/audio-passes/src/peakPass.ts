// peakPass.ts — the measuring half of a COLD module: read a file's true peak and write it into the
// param the module reads it from, immediately before the render. Without it a normaliser applies
// its default gain instead of normalising. Full rationale: docs/peakPass.md.

import { measureFilePeak } from "@studio/audio-analysis/peak";
import type { PluginDoc } from "@studio/song/project";

/** The param a MEASURING cold module receives its number in — one name, spelled once. */
export const PEAK_PARAM = "Peak";

/** The floor a measurement reports for silence, and the `Peak` param's minimum — spelled in @studio/audio-analysis. */
export { PEAK_FLOOR_DB } from "@studio/audio-analysis/peak";

/** One file's true peak in dBFS, decoded by the engine and NOT read off the sidecar — docs/peakPass.md. */
export async function measureFilePeakDb(
  engineBin: string,
  source: string,
): Promise<number> {
  try {
    return (await measureFilePeak(source, { engineBin })).peakDb;
  } catch (e) {
    throw new Error(
      `could not measure the peak of ${source}: ${(e as Error).message}`,
    );
  }
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
