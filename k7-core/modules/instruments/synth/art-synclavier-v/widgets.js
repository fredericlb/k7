// synclavier-v screens: the timbre's volume and index envelopes, and the four partials' FM spectra.
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const WHITE = "#ffffff";
const ORANGE = "#ff6a1a";
const GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

function num(v, d) {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function lastPeak(arr) {
  return Array.isArray(arr) && arr.length > 0 ? clamp01(num(arr[arr.length - 1], 0)) : 0;
}

// A timbre adjust knob scales its envelope stage: 0.5 leaves it, 0 shortens it 4x, 1 lengthens it 4x.
function scale(adj) {
  return Math.pow(4, (num(adj, 0.5) - 0.5) * 2);
}

// One partial-1 envelope as [x, y] points over a unit-time axis; the release starts at 0.72.
function envPoints(p, kind, adj) {
  const k = kind;
  const dly = num(p[`${k} Envelope Delay 1`], 0) * 0.15;
  const att = num(p[`${k} Envelope Attack 1`], 0.012) * 0.35 * scale(adj.att) + 0.005;
  const peak = clamp01(num(p[`${k} Envelope Peak 1`], 1));
  const dec = num(p[`${k} Envelope Initial Decay 1`], 0) * 0.35 * scale(adj.dec) + 0.005;
  const sus = clamp01(num(p[`${k} Envelope Sustain 1`], 1)) * peak;
  const rel = num(p[`${k} Envelope Final Decay 1`], 0.3) * 0.35 * scale(adj.rel) + 0.01;
  const hold = 0.72;
  const a = Math.min(dly + att, hold - 0.02);
  const d = Math.min(a + dec, hold - 0.01);
  return [
    [0, 0],
    [Math.min(dly, a), 0],
    [a, peak],
    [d, sus],
    [hold, sus],
    [Math.min(hold + rel, 1), 0],
  ];
}

function strokePath(ctx, pts, x0, y0, w, h, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const px = x0 + x * w;
    const py = y0 + (1 - y) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

function env_screen(lcd) {
  const { ctx, width: W, height: H, params: p, output } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (W < 20 || H < 20) return;
  const x0 = 6;
  const y0 = 14;
  const w = W - 18;
  const h = H - 24;
  ctx.strokeStyle = GREY;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + h + 0.5);
  ctx.lineTo(x0 + w, y0 + h + 0.5);
  ctx.moveTo(x0 + 0.72 * w + 0.5, y0);
  ctx.lineTo(x0 + 0.72 * w + 0.5, y0 + h);
  ctx.stroke();
  const vol = envPoints(p, "Volume", {
    att: p["Timbre Vol Env Attack"],
    dec: p["Timbre Vol Env Initial Decay"],
    rel: p["Timbre Vol Env Final Decay"],
  });
  const idx = envPoints(p, "Index", {
    att: p["Timbre Index Env Attack"],
    dec: p["Timbre Index Env Initial Decay"],
    rel: p["Timbre Index Env Final Decay"],
  });
  // The index envelope is drawn at its depth: a partial with no FM shows a flat blue line.
  const depth = clamp01(num(p["Modulator Depth 1"], 0) * 0.8 + 0.2);
  strokePath(ctx, idx.map(([x, y]) => [x, y * depth]), x0, y0, w, h, BLUE);
  strokePath(ctx, vol, x0, y0, w, h, WHITE);
  ctx.font = FONT;
  ctx.fillStyle = WHITE;
  ctx.fillText("VOL", x0, 9);
  ctx.fillStyle = BLUE;
  ctx.fillText("INDEX", x0 + 22, 9);
  ctx.fillStyle = GREY;
  ctx.fillText("REL", x0 + 0.72 * w + 3, 9);
  // Output level: a thin bar on the right edge, orange when the timbre sounds.
  const lv = lastPeak(output);
  ctx.strokeStyle = GREY;
  ctx.strokeRect(W - 7.5, y0 + 0.5, 4, h - 1);
  if (lv > 0) {
    ctx.fillStyle = ORANGE;
    ctx.fillRect(W - 7, y0 + h * (1 - lv), 3, h * lv);
  }
}

// FM sidebands of one partial: the carrier at the centre, pairs at ±k·ratio, shrinking with k / index.
function spec_screen(lcd) {
  const { ctx, width: W, height: H, params: p } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (W < 40 || H < 24) return;
  const lanes = 4;
  const lw = W / lanes;
  const base = H - 12;
  const top = 6;
  const colors = [WHITE, GREEN, ORANGE, BLUE];
  ctx.font = FONT;
  for (let i = 0; i < lanes; i++) {
    const n = i + 1;
    const cx = lw * i + lw / 2;
    const muted = num(p[`Partial Mute ${n}`], 0) >= 0.5;
    const vol = clamp01(num(p[`Partial Volume ${n}`], 0));
    const ratio = Math.max(0, num(p[`Partial FM Ratio ${n}`], 0.0625) * 16);
    const index = clamp01(num(p[`Modulator Depth ${n}`], 0)) * 4;
    const col = muted ? GREY : colors[i];
    const amp = (base - top) * vol;
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(lw * i + 3, base + 0.5);
    ctx.lineTo(lw * (i + 1) - 3, base + 0.5);
    ctx.stroke();
    // Sidebands spread by the ratio: a ratio of 1 puts them one step apart.
    const step = Math.max(2, Math.min(lw / 8, (lw / 8) * Math.min(ratio, 2)));
    let term = 1;
    for (let k = 1; k <= 4; k++) {
      term *= index / (k * 1.5);
      const h = amp * Math.min(1, term);
      if (h < 0.5) break;
      ctx.fillStyle = muted ? GREY : BLUE;
      for (const s of [-1, 1]) {
        const x = cx + s * k * step;
        if (x > lw * i + 2 && x < lw * (i + 1) - 2) ctx.fillRect(Math.round(x) - 0.5, base - h, 1, h);
      }
    }
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(cx) - 1.5, base - amp, 3, amp);
    if (amp > 1) {
      ctx.beginPath();
      ctx.arc(cx, base - amp, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = muted ? GREY : WHITE;
    ctx.fillText(`P${n}`, lw * i + 4, H - 2);
    ctx.fillStyle = GREY;
    const r = ratio.toFixed(ratio < 10 ? 2 : 1);
    ctx.fillText(muted ? "MUTE" : `x${r}`, lw * i + lw - 4 - ctx.measureText(muted ? "MUTE" : `x${r}`).width, H - 2);
  }
}

export default { env_screen, spec_screen };
