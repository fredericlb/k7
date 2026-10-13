// piano-v3 screens: where the hammer strikes and the partials it leaves, the EQ curve, the compressor's transfer curve.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

function clear(lcd) {
  lcd.ctx.fillStyle = "#000";
  lcd.ctx.fillRect(0, 0, lcd.width, lcd.height);
}

function text(ctx, s, x, y, c, align) {
  ctx.fillStyle = c;
  ctx.font = FONT;
  ctx.textAlign = align || "left";
  ctx.fillText(s, x, y);
}

function peak(arr) {
  if (!arr || !arr.length) return 0;
  let m = 0;
  for (let i = Math.max(0, arr.length - 16); i < arr.length; i++) m = Math.max(m, arr[i] || 0);
  return m;
}

// The plugin's switches are labelled "Bypass" but read Off/On: 1 is the section switched on.
const on = (v) => (v ?? 0) >= 0.5;

export default {
  hammer_screen(lcd) {
    clear(lcd);
    const { ctx, width: W, height: H, params: p, output } = lcd;
    const pos = 0.04 + (p["Hammer Position"] ?? 0.51) * 0.22;
    const hard = p["Hammer Hardness"] ?? 0.75;
    const bright = p["Brightness"] ?? 0;
    const harm = p["Harmonics"] ?? 0;
    const inharm = (p["Stretch Tuning"] ?? 0.03) * 0.004 + (1 - (p["String Tension"] ?? 0.5)) * 0.0015;
    const lid = p["Lid Position"] ?? 1;
    const sy = 22, x0 = 6, x1 = W - 6;
    const lv = peak(output);
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60, y = sy + Math.sin(Math.PI * t) * lv * 6 * Math.sin(Math.PI * 3 * t);
      if (i === 0) ctx.moveTo(x0, y); else ctx.lineTo(x0 + t * (x1 - x0), y);
    }
    ctx.stroke();
    ctx.fillStyle = GREY;
    ctx.fillRect(x0 - 2, sy - 4, 2, 8);
    ctx.fillRect(x1, sy - 4, 2, 8);
    const hx = x0 + pos * (x1 - x0);
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(hx, sy + 6 + (1 - hard) * 2, 3 + hard * 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(x1 - 40, 10);
    ctx.lineTo(x1 - 40 + 36 * Math.cos(lid * 0.6), 10 - 8 * Math.sin(lid * 0.6));
    ctx.stroke();
    text(ctx, lid < 0.25 ? "LID SHUT" : lid < 0.75 ? "LID HALF" : "LID OPEN", x1 - 44, 9, GREY, "right");
    text(ctx, "HAMMER", 4, 9, ORANGE);
    const top = 40, base = H - 12, n = 16;
    const span = Math.max(1, (x1 - x0) / (n * Math.sqrt(1 + inharm * n * n)));
    for (let k = 1; k <= n; k++) {
      const strike = Math.abs(Math.sin(k * Math.PI * pos));
      const roll = Math.exp(-(k - 1) * (0.35 - hard * 0.22 - bright * 0.1 - harm * 0.05));
      const a = Math.min(1, strike * roll / Math.max(0.2, Math.sin(Math.PI * pos)));
      const x = x0 + (k * Math.sqrt(1 + inharm * k * k) - 1) * span;
      const h = (base - top) * a;
      ctx.fillStyle = k === 1 ? WHITE : a < 0.08 ? GREY : BLUE;
      ctx.fillRect(x, base - Math.max(1, h), Math.max(2, span * 0.5), Math.max(1, h));
    }
    text(ctx, "PARTIALS", 4, H - 2, GREY);
    const st = p["Stretch Tuning"] ?? 0;
    if (st > 0.05) text(ctx, "STRETCH", W - 4, H - 2, GREEN, "right");
  },

  eq_screen(lcd) {
    clear(lcd);
    const { ctx, width: W, height: H, params: p } = lcd;
    const live = on(p["Equalizer Bypass"]);
    const hz = (v) => 20 * Math.pow(1000, Math.max(0, Math.min(1, v)));
    const db = (v) => ((v ?? 0.5) - 0.5) * 30;
    const lf = hz(p["Low Shelf Freq"] ?? 0.34), lg = db(p["Low Shelf Gain"]);
    const hf = hz(p["High Shelf Freq"] ?? 0.77), hg = db(p["High Shelf Gain"]);
    const bf = hz(p["Bell Freq"] ?? 0.54), bg = db(p["Presence Gain"]), bw = 0.3 + (p["Bell Width"] ?? 0.5) * 2;
    const resp = (f) => {
      const lo = lg / (1 + Math.pow(f / lf, 2));
      const hi = hg / (1 + Math.pow(hf / f, 2));
      const oct = Math.log2(f / bf) / bw;
      return lo + hi + bg * Math.exp(-oct * oct * 2);
    };
    const y = (d) => H / 2 - (Math.max(-15, Math.min(15, d)) / 15) * (H / 2 - 10);
    ctx.strokeStyle = "#1a1a1a";
    ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(W, y(0)); ctx.stroke();
    ctx.strokeStyle = live ? BLUE : GREY;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const f = 20 * Math.pow(1000, x / W), yy = y(live ? resp(f) : 0);
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
    const dot = (f, d, c) => {
      ctx.fillStyle = live ? c : GREY;
      ctx.beginPath();
      ctx.arc((Math.log10(f / 20) / 3) * W, y(live ? resp(f) : 0), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    };
    dot(lf, lg, WHITE);
    dot(bf, bg, ORANGE);
    dot(hf, hg, WHITE);
    text(ctx, live ? "EQ" : "EQ OFF", 4, 9, live ? WHITE : GREY);
  },

  comp_screen(lcd) {
    clear(lcd);
    const { ctx, width: W, height: H, params: p, output } = lcd;
    const live = on(p["Compressor Bypass"]);
    const thr = -48 + (p["Comp Threshold"] ?? 1) * 48;
    const ratio = 1 + (p["Comp Ratio"] ?? 0) * 19;
    const S = Math.min(W - 40, H - 8), x0 = 4, y0 = 4;
    const map = (d) => (d + 48) / 48;
    const out = (d) => (d <= thr ? d : thr + (d - thr) / ratio);
    ctx.strokeStyle = "#1a1a1a";
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, S, S);
    ctx.beginPath(); ctx.moveTo(x0, y0 + S); ctx.lineTo(x0 + S, y0); ctx.stroke();
    ctx.strokeStyle = live ? GREEN : GREY;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const d = -48 + i, o = live ? out(d) : d;
      const px = x0 + map(d) * S, py = y0 + S - map(o) * S;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    const lv = peak(output);
    if (lv > 0.001) {
      const d = Math.max(-48, 20 * Math.log10(lv));
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.arc(x0 + map(d) * S, y0 + S - map(live ? out(d) : d) * S, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    text(ctx, live ? `${ratio.toFixed(1)}:1` : "OFF", W - 4, 12, live ? GREEN : GREY, "right");
    text(ctx, "COMP", W - 4, H - 4, GREY, "right");
  },
};
