// compressor — what its lcdscreen draws: the transfer curve on the left, and on the right the
// last seconds of signal, input against output with the makeup gain taken back out, so the
// lit band between them is exactly what the compressor removed. The curve is Tracktion's own
// law (linear domain: above T, out = T + (in - T) * ratio, then the output gain); the band and
// the GR readout are MEASURED off the engine's taps either side of the plugin, never simulated.

const FLOOR = -48; // dB at the bottom of every scale
const db = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
const lin = (d) => 10 ** (d / 20);

// The compressor's static curve, output level for an input level, both linear.
const curve = (x, t, ratio, makeup) =>
  (x <= t ? x : t + (x - t) * ratio) * makeup;

// The loudest point of `a` between two indices — the peak a pixel column stands for.
function peak(a, from, to) {
  let m = 0;
  for (let i = Math.max(0, from); i < Math.min(a.length, to); i++)
    if (a[i] > m) m = a[i];
  return m;
}

export default {
  screen(lcd) {
    const { ctx, width: W, height: H, params, input, output, color } = lcd;
    const t = params.Threshold ?? 0.501;
    const ratio = params.Ratio ?? 0.5;
    const makeupDb = params["Output gain"] ?? 0;
    const makeup = lin(makeupDb);
    ctx.font = "8px ui-monospace, monospace";
    ctx.textBaseline = "top";

    // Gain reduction NOW, off the last ~50 ms of both taps, with meter ballistics kept in `state`.
    const n = Math.min(input.length, output.length);
    const inNow = peak(input, input.length - 8, input.length);
    const outNow = peak(output, output.length - 8, output.length);
    const grRaw =
      n && inNow > 1e-4 ? Math.min(0, db(outNow) - makeupDb - db(inNow)) : 0;
    const s = lcd.state;
    s.gr = grRaw < (s.gr ?? 0) ? grRaw : (s.gr ?? 0) * 0.85 + grRaw * 0.15;

    // Header: the settings as a person reads them, then the one live number.
    const ratioText = ratio > 0.001 ? `${(1 / ratio).toFixed(1)}:1` : "inf:1";
    ctx.fillStyle = color.dim;
    ctx.fillText(`T ${db(t).toFixed(1)}dB  ${ratioText}`, 2, 1);
    ctx.fillStyle = s.gr < -0.5 ? color.glow : color.ink;
    const grText = n ? `GR ${s.gr.toFixed(1)}dB` : "GR --";
    ctx.fillText(grText, W - ctx.measureText(grText).width - 2, 1);

    // --- the transfer curve, a square on the left ---------------------------------------------
    const top = 11;
    const S = Math.max(10, H - top - 2);
    const toX = (d) => 2 + ((d - FLOOR) / -FLOOR) * S;
    const toY = (d) => top + (1 - (d - FLOOR) / -FLOOR) * S;
    ctx.save();
    ctx.beginPath();
    ctx.rect(2, top, S, S);
    ctx.clip();
    ctx.strokeStyle = color.dim;
    ctx.lineWidth = 1;
    ctx.strokeRect(2.5, top + 0.5, S - 1, S - 1);
    // Unity, dashed: how far the curve bends under it is the compression.
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(toX(FLOOR), toY(FLOOR));
    ctx.lineTo(toX(0), toY(0));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = color.ink;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let px = 0; px <= S; px++) {
      const d = FLOOR + (px / S) * -FLOOR;
      const y = toY(db(curve(lin(d), t, ratio, makeup)));
      if (px === 0) ctx.moveTo(2 + px, y);
      else ctx.lineTo(2 + px, y);
    }
    ctx.stroke();
    // Where the signal sits on the curve right now.
    if (n && inNow > lin(FLOOR)) {
      const d = db(inNow);
      ctx.fillStyle = color.glow;
      ctx.beginPath();
      ctx.arc(toX(d), toY(db(curve(inNow, t, ratio, makeup))), 2.2, 0, 7);
      ctx.fill();
    }
    ctx.restore();

    // --- the history, right of the square -----------------------------------------------------
    const x0 = S + 7;
    const w = W - x0 - 2;
    if (w < 8) return;
    const yOf = (d) =>
      top + (1 - (Math.max(FLOOR, Math.min(0, d)) - FLOOR) / -FLOOR) * S;
    const bottom = top + S;
    ctx.strokeStyle = color.dim;
    ctx.strokeRect(x0 + 0.5, top + 0.5, w - 1, S - 1);
    // The threshold, where compression starts.
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x0, yOf(db(t)) + 0.5);
    ctx.lineTo(x0 + w, yOf(db(t)) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!n) {
      ctx.fillStyle = color.dim;
      ctx.fillText("no signal", x0 + 4, top + S / 2 - 4);
      return;
    }
    // One column per pixel, newest on the right; both taps end NOW, so they are aligned from the end.
    const per = Math.max(1, Math.floor(n / w));
    for (let c = 0; c < w; c++) {
      const back = (w - c) * per;
      const i = input.length - back;
      const o = output.length - back;
      if (i < 0 || o < 0) continue;
      const inDb = db(peak(input, i, i + per));
      const outDb = db(peak(output, o, o + per)) - makeupDb;
      const x = x0 + c;
      // What came in, faint…
      ctx.fillStyle = color.dim;
      ctx.fillRect(x, yOf(inDb), 1, bottom - yOf(inDb));
      // …what was taken off it, lit…
      if (inDb - outDb > 0.3) {
        ctx.fillStyle = color.glow;
        ctx.fillRect(x, yOf(inDb), 1, yOf(outDb) - yOf(inDb));
      }
      // …and what went on, as the line on top of what is left.
      ctx.fillStyle = color.ink;
      ctx.fillRect(x, yOf(outDb), 1, 1);
    }
  },
};
