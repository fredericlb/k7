// nam-ir.ts — does a NAM module's cabinet IR reach the SOUND, and is it the IR it was given? Offline,
// no engine needed: the same sawtooth through the same model, with and without an IR, and the change
// at every harmonic compared to the IR's own frequency response at that harmonic.
//
//   npx tsx engine/st0-engine/scripts/nam-ir.ts <model.nam> <cabinet.wav>
//
// Convolution multiplies each frequency by the IR's response there, so after the amp the difference
// between the two renders, harmonic by harmonic, IS that response — relative to the fundamental,
// since the IR is normalised. An IR ignored gives 0 everywhere; a wrong one another curve.

import { F0, HARMONICS, readWav, renderAt } from "./nam-rate.ts";

/** The IR's gain at `f`, in dB — one DFT bin, computed at exactly that frequency. */
function responseDb(ir: Float32Array, rate: number, f: number): number {
  let re = 0;
  let im = 0;
  for (let n = 0; n < ir.length; n++) {
    const a = (-2 * Math.PI * f * n) / rate;
    re += ir[n] * Math.cos(a);
    im += ir[n] * Math.sin(a);
  }
  return 20 * Math.log10(Math.hypot(re, im) + 1e-12);
}

async function main() {
  const [model, cabinet] = process.argv.slice(2);
  if (!model || !cabinet) {
    console.error("usage: nam-ir.ts <model.nam> <cabinet.wav>");
    process.exit(2);
  }
  const { rate, x: ir } = readWav(cabinet);
  const dry = await renderAt(model, rate);
  const cab = await renderAt(model, rate, { irFile: cabinet });
  const h1 = responseDb(ir, rate, F0);
  const rows = dry.map((d, i) => ({
    k: i + 1,
    heard: cab[i] - d,
    expected: responseDb(ir, rate, (i + 1) * F0) - h1,
  }));
  // Only where the amp put something to hear: below −60 dB the measurement is the render's noise.
  const judged = rows.filter((r) => dry[r.k - 1] > -60);
  const err = judged.reduce((s, r) => s + Math.abs(r.heard - r.expected), 0) / judged.length;
  for (const r of rows.filter((r) => [2, 5, 10, 20, 30, 40, 50].includes(r.k)))
    console.log(`  h${String(r.k).padEnd(3)} heard ${r.heard.toFixed(1).padStart(6)} dB   IR says ${r.expected.toFixed(1).padStart(6)} dB`);
  console.log(`${judged.length} harmonics, mean |heard − IR| ${err.toFixed(2)} dB`);
  const ok = err < 1.5;
  console.log(ok ? "OK — the cabinet heard is the IR given" : "ECHEC — not the IR's response");
  process.exit(ok ? 0 : 1);
}

void main();
