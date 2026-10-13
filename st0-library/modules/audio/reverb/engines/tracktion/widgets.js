// reverb — the tail's decay in dB, lows and highs apart, from Freeverb's comb feedback and damping.

const LOW = "#ffffff";
const HIGH = "#3d7dff";
const FROZEN = "#ff6a1a";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const DB_FLOOR = -60;
// Freeverb's mean comb length, about 1400 samples at 44.1 kHz.
const COMB_S = 0.0317;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Seconds for a loop gain g to fall 60 dB, one comb pass at a time.
const rt60 = (g) => (g >= 0.9999 ? Infinity : (3 * COMB_S) / Math.max(1e-6, -Math.log10(Math.max(1e-6, g))));

export default {
  tail(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;

    const pad = 6;
    const top = 14;
    const w = Math.max(1, W - pad * 2);
    const h = Math.max(1, H - top - pad);

    // JUCE: feedback = size · 0.28 + 0.7, damp = damping · 0.4, and Freeze at 0.5 or above holds the loop at 1.
    const frozen = (params["Freeze"] ?? 0) >= 0.5;
    const size = clamp01(params["Room Size"] ?? 0.3);
    const damp = clamp01(params["Damping"] ?? 0.5) * 0.4;
    const gLow = frozen ? 1 : size * 0.28 + 0.7;
    const gHigh = frozen ? 1 : gLow * ((1 - damp) / (1 + damp));
    const rtLow = rt60(gLow);
    const rtHigh = rt60(gHigh);
    const windowS = Number.isFinite(rtLow) ? Math.max(0.5, rtLow * 1.2) : 4;

    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(pad, top + h - 0.5);
    ctx.lineTo(W - pad, top + h - 0.5);
    ctx.stroke();

    const line = (rt, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let i = 0; i <= w; i += 2) {
        const s = (i / w) * windowS;
        const db = Number.isFinite(rt) ? Math.max(DB_FLOOR, (-60 * s) / Math.max(1e-6, rt)) : 0;
        const y = top + (db / DB_FLOOR) * (h - 1);
        if (i === 0) ctx.moveTo(pad + i, y);
        else ctx.lineTo(pad + i, y);
      }
      ctx.stroke();
    };
    line(rtHigh, frozen ? FROZEN : HIGH);
    line(rtLow, frozen ? FROZEN : LOW);

    ctx.textAlign = "left";
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.fillStyle = frozen ? FROZEN : LOW;
    ctx.fillText(frozen ? "FREEZE" : `${rtLow.toFixed(1)} S`, pad, 11);
    ctx.font = FONT;
    ctx.textAlign = "right";
    ctx.fillStyle = HIGH;
    ctx.fillText(frozen ? "∞" : `HIGH ${rtHigh.toFixed(1)} S`, W - pad, 10);
  },
};
