// Screens for CMI V: the global amplitude shape, then each track's own shape and sample window and loop.
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const ORANGE = "#ff6a1a";
const WHITE = "#ffffff";
const GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

function text(ctx, s, x, y, color, align) {
  ctx.font = FONT;
  ctx.fillStyle = color;
  ctx.textAlign = align || "left";
  ctx.textBaseline = "top";
  ctx.fillText(s, x, y);
}

function blank(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
}

// Attack ramp, then damping 1 while held, then damping 2 after the key is up; vib wobbles the held part.
function drawEnv(lcd, attack, damp1, damp2, vibDepth, vibSpeed, title) {
  const { ctx, width: W, height: H, output, state } = lcd;
  blank(ctx, W, H);
  if (W < 30 || H < 24) return;
  const top = 12;
  const bot = H - 4;
  const span = bot - top;
  const xA = 4 + attack * W * 0.3;
  const xUp = W * 0.68;
  const tau1 = 0.05 + (1 - damp1) * 3;
  const tau2 = 0.02 + (1 - damp2) * 0.6;
  ctx.strokeStyle = GREY;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bot + 0.5);
  ctx.lineTo(W, bot + 0.5);
  ctx.moveTo(xUp + 0.5, top);
  ctx.lineTo(xUp + 0.5, bot);
  ctx.stroke();
  ctx.strokeStyle = GREEN;
  ctx.beginPath();
  ctx.moveTo(4, bot);
  ctx.lineTo(xA, top);
  let held = 1;
  for (let x = xA; x <= xUp; x += 1) {
    const t = (x - xA) / Math.max(1, W);
    held = Math.exp(-t / tau1);
    const wob = 1 + vibDepth * 0.15 * Math.sin(t * (6 + vibSpeed * 60) * Math.PI * 2);
    ctx.lineTo(x, bot - clamp(held * wob, 0, 1) * span);
  }
  for (let x = xUp; x <= W - 2; x += 1) {
    const t = (x - xUp) / Math.max(1, W);
    ctx.lineTo(x, bot - held * Math.exp(-t / tau2) * span);
  }
  ctx.stroke();
  const out = output && output.length ? clamp(output[output.length - 1], 0, 1) : 0;
  state.lvl = (state.lvl ?? 0) * 0.6 + out * 0.4;
  if (state.lvl > 0.01) {
    ctx.fillStyle = WHITE;
    ctx.fillRect(W - 4, bot - state.lvl * span, 3, state.lvl * span);
  }
  text(ctx, title, 3, 2, GREY);
  text(ctx, "KEY UP", xUp - 3, 2, GREY, "right");
}

// A track's amplitude shape, its own params read through `T`, the prefix every track param carries.
function voice(lcd, n) {
  const T = `Track ${n} `;
  const p = lcd.params;
  drawEnv(
    lcd,
    clamp(p[T + "AttackTime"] ?? 0, 0, 1),
    clamp(p[T + "Damping1"] ?? 0, 0, 1),
    clamp(p[T + "Damping2"] ?? 0, 0, 1),
    clamp(p[T + "VibratoDepth"] ?? 0, 0, 1),
    clamp(p[T + "VibratoSpeed"] ?? 0, 0, 1),
    `TRACK ${n}`,
  );
}

// A track's sample window and loop.
function sample(lcd, n) {
  const T = `Track ${n} `;
  const { ctx, width: W, height: H, params: p, output } = lcd;
  blank(ctx, W, H);
  if (W < 30 || H < 30) return;
  const start = clamp(p[T + "StartSeg"] ?? 0, 0, 1);
  const len = clamp(p[T + "SampleLength"] ?? 1, 0, 1);
  const lStart = clamp(p[T + "LoopStart"] ?? 0, 0, 1);
  const lLen = clamp(p[T + "LoopLength"] ?? 1, 0, 1);
  const looping = (p[T + "LoopActive"] ?? 0) >= 0.5;
  const bf = (p[T + "BFLoop"] ?? 0) >= 0.5;
  const x0 = 4;
  const w = W - 8;
  const mid = H / 2 + 4;
  const half = H / 2 - 12;
  const xs = x0 + start * w;
  const xe = Math.max(xs + 1, x0 + len * w);
  // The sample as a stack of thin bars, dimmed outside the played window.
  for (let k = 0; k < 64; k++) {
    const x = x0 + (k + 0.5) * (w / 64);
    const a = Math.exp(-k / 28) * (0.55 + 0.45 * Math.abs(Math.sin(k * 1.7)));
    ctx.fillStyle = x >= xs && x <= xe ? WHITE : GREY;
    ctx.fillRect(Math.round(x), mid - a * half, 1, a * half * 2);
  }
  if (looping) {
    const ls = xs + lStart * (xe - xs);
    const le = Math.min(xe, ls + Math.max(0.02, lLen) * (xe - ls));
    ctx.fillStyle = "rgba(61,125,255,0.25)";
    ctx.fillRect(ls, mid - half - 2, le - ls, half * 2 + 4);
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(ls) + 0.5, mid - half - 2.5, Math.max(1, Math.round(le - ls)), half * 2 + 5);
    text(ctx, bf ? "LOOP <>" : "LOOP >>", W - 3, 2, BLUE, "right");
  }
  ctx.fillStyle = ORANGE;
  ctx.fillRect(Math.round(xs), mid - half - 4, 2, half * 2 + 8);
  ctx.fillStyle = GREEN;
  ctx.fillRect(Math.round(xe) - 1, mid - half - 4, 2, half * 2 + 8);
  const out = output && output.length ? clamp(output[output.length - 1], 0, 1) : 0;
  if (out > 0.01) {
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(xs, mid - half - 4, 2 + out * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  text(ctx, "SAMPLE", 3, 2, GREY);
}

const screens = {
  env_screen(lcd) {
    const p = lcd.params;
    drawEnv(
      lcd,
      clamp(p["Global Attack"] ?? 0, 0, 1),
      clamp(p["Global Damping1"] ?? 0, 0, 1),
      clamp(p["Global Damping2"] ?? 0, 0, 1),
      clamp(p["Global VibDepth"] ?? 0, 0, 1),
      clamp(p["Global VibSpeed"] ?? 0, 0, 1),
      "ALL TRACKS",
    );
  },
};

// One voice and one sample screen per track tab, named `<screen>_<track>` as ui.k7x places them.
for (let n = 1; n <= 10; n++) {
  screens[`voice_screen_${n}`] = (lcd) => voice(lcd, n);
  screens[`sample_screen_${n}`] = (lcd) => sample(lcd, n);
}

export default screens;
