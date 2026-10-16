// dx7-v screens: the algorithm's operator graph, and the six operator envelopes with the pitch envelope.
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const WHITE = "#ffffff";
const ORANGE = "#ff6a1a";
const GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

// The 32 DX7 algorithms: m = [modulator, target] edges, c = carriers, f = the operator with feedback.
const ALGOS = [
  { m: [[6, 5], [5, 4], [4, 3], [2, 1]], c: [1, 3], f: 6 },
  { m: [[6, 5], [5, 4], [4, 3], [2, 1]], c: [1, 3], f: 2 },
  { m: [[6, 5], [5, 4], [3, 2], [2, 1]], c: [1, 4], f: 6 },
  { m: [[6, 5], [5, 4], [3, 2], [2, 1]], c: [1, 4], f: 4 },
  { m: [[6, 5], [4, 3], [2, 1]], c: [1, 3, 5], f: 6 },
  { m: [[6, 5], [4, 3], [2, 1]], c: [1, 3, 5], f: 5 },
  { m: [[6, 5], [5, 3], [4, 3], [2, 1]], c: [1, 3], f: 6 },
  { m: [[6, 5], [5, 3], [4, 3], [2, 1]], c: [1, 3], f: 4 },
  { m: [[6, 5], [5, 3], [4, 3], [2, 1]], c: [1, 3], f: 2 },
  { m: [[3, 2], [2, 1], [6, 4], [5, 4]], c: [1, 4], f: 3 },
  { m: [[3, 2], [2, 1], [6, 4], [5, 4]], c: [1, 4], f: 6 },
  { m: [[2, 1], [6, 3], [5, 3], [4, 3]], c: [1, 3], f: 2 },
  { m: [[2, 1], [6, 3], [5, 3], [4, 3]], c: [1, 3], f: 6 },
  { m: [[2, 1], [6, 4], [5, 4], [4, 3]], c: [1, 3], f: 6 },
  { m: [[2, 1], [6, 4], [5, 4], [4, 3]], c: [1, 3], f: 2 },
  { m: [[2, 1], [4, 3], [3, 1], [6, 5], [5, 1]], c: [1], f: 6 },
  { m: [[2, 1], [4, 3], [3, 1], [6, 5], [5, 1]], c: [1], f: 2 },
  { m: [[2, 1], [3, 1], [6, 5], [5, 4], [4, 1]], c: [1], f: 3 },
  { m: [[3, 2], [2, 1], [6, 4], [6, 5]], c: [1, 4, 5], f: 6 },
  { m: [[3, 1], [3, 2], [5, 4], [6, 4]], c: [1, 2, 4], f: 3 },
  { m: [[3, 1], [3, 2], [6, 4], [6, 5]], c: [1, 2, 4, 5], f: 3 },
  { m: [[2, 1], [6, 3], [6, 4], [6, 5]], c: [1, 3, 4, 5], f: 6 },
  { m: [[3, 2], [6, 4], [6, 5]], c: [1, 2, 4, 5], f: 6 },
  { m: [[6, 3], [6, 4], [6, 5]], c: [1, 2, 3, 4, 5], f: 6 },
  { m: [[6, 4], [6, 5]], c: [1, 2, 3, 4, 5], f: 6 },
  { m: [[3, 2], [5, 4], [6, 4]], c: [1, 2, 4], f: 6 },
  { m: [[3, 2], [5, 4], [6, 4]], c: [1, 2, 4], f: 3 },
  { m: [[2, 1], [5, 4], [4, 3]], c: [1, 3, 6], f: 5 },
  { m: [[4, 3], [6, 5]], c: [1, 2, 3, 5], f: 6 },
  { m: [[5, 4], [4, 3]], c: [1, 2, 3, 6], f: 5 },
  { m: [[6, 5]], c: [1, 2, 3, 4, 5], f: 6 },
  { m: [], c: [1, 2, 3, 4, 5, 6], f: 6 },
];

function num(v, d) {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function opOn(p, n) {
  return num(p[`Op ${n}  Osc On/Off`], 1) >= 0.5;
}

// Lays the graph out: carriers on the bottom row, each modulator one row above the highest op it feeds.
function layout(algo) {
  const depth = {};
  const targets = {};
  for (let n = 1; n <= 6; n++) targets[n] = [];
  for (const [a, b] of algo.m) targets[a].push(b);
  const d = (n, guard) => {
    if (depth[n] !== undefined) return depth[n];
    if (guard > 6 || targets[n].length === 0) return (depth[n] = 0);
    return (depth[n] = 1 + Math.max(...targets[n].map((t) => d(t, guard + 1))));
  };
  for (let n = 1; n <= 6; n++) d(n, 0);
  const x = {};
  algo.c.forEach((n, i) => {
    x[n] = (i + 0.5) / algo.c.length;
  });
  const maxD = Math.max(...Object.values(depth));
  for (let lv = 1; lv <= maxD; lv++) {
    const row = [];
    for (let n = 1; n <= 6; n++) if (depth[n] === lv) row.push(n);
    for (const n of row) {
      const xs = targets[n].map((t) => x[t] ?? 0.5);
      x[n] = xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
    }
    // Two modulators over the same op are spread apart so neither hides the other.
    row.sort((a, b) => x[a] - x[b] || b - a);
    for (let i = 1; i < row.length; i++) {
      const gap = 0.16;
      if (x[row[i]] - x[row[i - 1]] < gap) x[row[i]] = x[row[i - 1]] + gap;
    }
    if (row.length > 1) {
      const over = x[row[row.length - 1]] - 0.92;
      if (over > 0) for (const n of row) x[n] -= over;
    }
  }
  return { depth, x, maxD };
}

function algo_screen(lcd) {
  const { ctx, width: W, height: H, params: p, output } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (W < 40 || H < 30) return;
  const idx = Math.max(0, Math.min(31, Math.round(num(p["Algorithm"], 0) * 31)));
  const algo = ALGOS[idx];
  const { depth, x, maxD } = layout(algo);
  const left = 34;
  const gw = W - left - 6;
  const rows = Math.max(1, maxD + 1);
  const bs = Math.max(8, Math.min(16, (H - 10) / (rows * 1.6)));
  const rowH = (H - 10 - bs) / Math.max(1, rows - 1 || 1);
  const pos = (n) => ({
    px: left + x[n] * gw,
    py: rows === 1 ? H / 2 : H - 6 - bs / 2 - depth[n] * rowH,
  });
  ctx.font = FONT;
  ctx.fillStyle = GREY;
  ctx.fillText("ALG", 4, 10);
  ctx.fillStyle = WHITE;
  ctx.font = "bold 20px ui-monospace, monospace";
  ctx.fillText(String(idx + 1), 4, 32);
  ctx.font = FONT;
  ctx.lineWidth = 1;
  ctx.strokeStyle = GREY;
  for (const [a, b] of algo.m) {
    const A = pos(a);
    const B = pos(b);
    ctx.beginPath();
    ctx.moveTo(A.px, A.py + bs / 2);
    ctx.lineTo(B.px, B.py - bs / 2);
    ctx.stroke();
  }
  // The carriers' output bus, lit by the level leaving the module.
  const lv = Array.isArray(output) && output.length ? clamp01(num(output[output.length - 1], 0)) : 0;
  ctx.strokeStyle = lv > 0.01 ? ORANGE : GREY;
  ctx.beginPath();
  ctx.moveTo(left, H - 2.5);
  ctx.lineTo(left + gw, H - 2.5);
  ctx.stroke();
  const fbAmt = clamp01(num(p["Feedback"], 0));
  for (let n = 1; n <= 6; n++) {
    const { px, py } = pos(n);
    const carrier = algo.c.includes(n);
    const on = opOn(p, n);
    const col = !on ? GREY : carrier ? WHITE : BLUE;
    const lvl = clamp01(num(p[`Op ${n}  Output Level`], 1));
    const bx = Math.round(px - bs / 2) + 0.5;
    const by = Math.round(py - bs / 2) + 0.5;
    ctx.fillStyle = col;
    ctx.fillRect(bx, by + bs * (1 - lvl), bs, bs * lvl);
    ctx.strokeStyle = col;
    ctx.strokeRect(bx, by, bs, bs);
    ctx.fillStyle = lvl > 0.55 && on ? "#000" : col;
    ctx.fillText(String(n), bx + bs / 2 - 2.5, by + bs / 2 + 3);
    if (carrier) {
      ctx.strokeStyle = GREY;
      ctx.beginPath();
      ctx.moveTo(px, by + bs);
      ctx.lineTo(px, H - 2.5);
      ctx.stroke();
    }
    if (n === algo.f) {
      ctx.strokeStyle = fbAmt > 0 ? ORANGE : GREY;
      ctx.beginPath();
      ctx.moveTo(bx + bs, by + bs * 0.7);
      ctx.lineTo(bx + bs + 4, by + bs * 0.7);
      ctx.lineTo(bx + bs + 4, by - 3);
      ctx.lineTo(px, by - 3);
      ctx.lineTo(px, by);
      ctx.stroke();
    }
  }
}

// One DADSR as [x, y] points over a unit-time axis; the key is released at 0.7.
function dadsr(p, prefix) {
  const dly = num(p[`${prefix} Delay`], 0) * 0.15;
  const att = num(p[`${prefix} Attack`], 0) * 0.3 + 0.004;
  const dec = num(p[`${prefix} Decay`], 0) * 0.3 + 0.004;
  const peak = clamp01(num(p[`${prefix} Peak`], 1));
  const sus = clamp01(num(p[`${prefix} Sustain`], 1));
  const rel = num(p[`${prefix} Release`], 0) * 0.3 + 0.01;
  const a = Math.min(dly + att, 0.68);
  const d = Math.min(a + dec, 0.69);
  return [[0, 0], [Math.min(dly, a), 0], [a, peak], [d, sus], [0.7, sus], [Math.min(0.7 + rel, 1), 0]];
}

function env_screen(lcd) {
  const { ctx, width: W, height: H, params: p } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (W < 30 || H < 24) return;
  const idx = Math.max(0, Math.min(31, Math.round(num(p["Algorithm"], 0) * 31)));
  const carriers = ALGOS[idx].c;
  const x0 = 4;
  const y0 = 12;
  const w = W - 8;
  const h = H - 16;
  ctx.strokeStyle = GREY;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + h + 0.5);
  ctx.lineTo(x0 + w, y0 + h + 0.5);
  ctx.stroke();
  const draw = (pts, color, scaleY, mid) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const px = x0 + x * w;
      const py = mid ? y0 + h / 2 - y * (h / 2) * scaleY : y0 + (1 - y * scaleY) * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  };
  // Modulators first, so the carriers (what you hear) are drawn on top.
  const order = [1, 2, 3, 4, 5, 6].sort((a, b) => Number(carriers.includes(a)) - Number(carriers.includes(b)));
  for (const n of order) {
    if (!opOn(p, n)) continue;
    const lvl = clamp01(num(p[`Op ${n}  Output Level`], 1));
    draw(dadsr(p, `Op ${n}  DADSR`), carriers.includes(n) ? WHITE : BLUE, lvl, false);
  }
  const pitch = dadsr(p, "Pitch DADSR");
  const peg = clamp01(num(p["Pitch EG"], 1));
  if (peg > 0) draw(pitch, GREEN, peg, true);
  ctx.font = FONT;
  ctx.fillStyle = WHITE;
  ctx.fillText("CAR", x0, 9);
  ctx.fillStyle = BLUE;
  ctx.fillText("MOD", x0 + 20, 9);
  ctx.fillStyle = GREEN;
  ctx.fillText("PITCH", x0 + 40, 9);
}

export default { algo_screen, env_screen };
