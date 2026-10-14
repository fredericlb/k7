// Screens for the B-3 V2 panel: the drawbar registration as bars and waveform, and the spinning Leslie.
const FEET = ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"];
const SHORT = ["16", "5⅓", "8", "4", "2⅔", "2", "1⅗", "1⅓", "1"];
const RATIO = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
// Hammond drawbar colours read on black glass: brown subs orange, white foundations white, black mutations blue.
const BAR_COLOR = ["#ff6a1a", "#ff6a1a", "#ffffff", "#ffffff", "#3d7dff", "#ffffff", "#3d7dff", "#3d7dff", "#ffffff"];

const bars = (params, manual) => FEET.map((f) => params[`${manual} Drawbar ${f}`] ?? 0);

function wave(levels, t) {
  let s = 0;
  for (let i = 0; i < levels.length; i++) s += levels[i] * Math.sin(2 * Math.PI * RATIO[i] * t);
  return s;
}

function trace(ctx, levels, x0, y0, w, h, color) {
  const total = levels.reduce((a, b) => a + b, 0);
  const norm = total > 0 ? total : 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let px = 0; px <= w; px++) {
    const t = (px / Math.max(1, w)) * 2;
    const y = y0 + h / 2 - (wave(levels, t) / norm) * (h / 2 - 2);
    if (px === 0) ctx.moveTo(x0 + px, y);
    else ctx.lineTo(x0 + px, y);
  }
  ctx.stroke();
}

function tone_screen(lcd) {
  const { ctx, width: W, height: H, params } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const up = bars(params, "Upper");
  const lo = bars(params, "Lower");
  const percOn = (params["Percussion Upper"] ?? 0) >= 0.5;
  const percIdx = (params["Percussion Harmonic"] ?? 0) >= 0.5 ? 4 : 3;
  const barH = Math.floor(H * 0.42);
  const top = 12;
  const slot = (W - 8) / 9;
  ctx.font = "8px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (let i = 0; i < 9; i++) {
    const x = 4 + i * slot;
    const bw = Math.max(2, slot * 0.5);
    const bx = x + (slot - bw) / 2;
    ctx.strokeStyle = "#6b6b6b";
    ctx.strokeRect(bx + 0.5, top + 0.5, bw - 1, barH - 1);
    const h = up[i] * barH;
    ctx.fillStyle = BAR_COLOR[i];
    ctx.fillRect(bx, top + barH - h, bw, h);
    const lh = lo[i] * barH;
    ctx.fillStyle = "#6b6b6b";
    ctx.fillRect(bx + bw + 1, top + barH - lh, 2, lh);
    ctx.fillStyle = "#6b6b6b";
    ctx.fillText(SHORT[i], x + slot / 2, top - 3);
    if (percOn && i === percIdx) {
      ctx.fillStyle = "#3ec96b";
      ctx.beginPath();
      ctx.arc(x + slot / 2, top + barH + 5, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const wy = top + barH + 12;
  const wh = H - wy - 2;
  if (wh > 8) {
    trace(ctx, lo, 4, wy, W - 8, wh, "#6b6b6b");
    trace(ctx, up, 4, wy, W - 8, wh, "#ffffff");
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(up.map((v) => Math.round(v * 8)).join(""), 4, H - 3);
}

function leslie_screen(lcd) {
  const { ctx, width: W, height: H, params, state, now } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const brake = (params["Rotary Speaker Brake"] ?? 0) >= 0.5;
  const fast = (params["Rotary Speaker Slow/Fast"] ?? 0) >= 0.5;
  const slowV = params["Rotary Speaker Slow Speed"] ?? 0.29;
  const fastV = params["Rotary Speaker Fast Speed"] ?? 0.8;
  const bal = params["Rotary Speaker Horn/Drum Balance"] ?? 0.4;
  const spread = params["Rotary Speaker Stereo Spread"] ?? 0.74;
  const target = brake ? 0 : fast ? 0.6 + fastV * 1.4 : 0.05 + slowV * 0.4;
  const last = typeof state.t === "number" ? state.t : now;
  const dt = Math.min(0.5, Math.max(0, (now - last) / 1000));
  state.t = now;
  state.v = typeof state.v === "number" ? state.v + (target - state.v) * Math.min(1, dt * 2) : target;
  state.horn = ((state.horn ?? 0) + state.v * dt * Math.PI * 2) % (Math.PI * 2);
  state.drum = ((state.drum ?? 0) + state.v * 0.8 * dt * Math.PI * 2) % (Math.PI * 2);
  const cx = W / 2;
  const r = Math.max(6, Math.min(W * 0.32, H * 0.22));
  ctx.strokeStyle = "#6b6b6b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, H / 2, Math.min(W, H) * 0.46, Math.PI - spread * 1.2, Math.PI + spread * 1.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, H / 2, Math.min(W, H) * 0.46, -spread * 1.2, spread * 1.2);
  ctx.stroke();
  const hy = H * 0.3;
  const hornAlpha = 0.35 + 0.65 * (1 - bal);
  const hx = Math.cos(state.horn) * r;
  ctx.globalAlpha = hornAlpha;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(cx - hx, hy);
  ctx.lineTo(cx + hx, hy);
  ctx.stroke();
  ctx.fillStyle = "#ff6a1a";
  ctx.beginPath();
  ctx.arc(cx + hx, hy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6b6b6b";
  ctx.beginPath();
  ctx.arc(cx - hx, hy, 2.5, 0, Math.PI * 2);
  ctx.fill();
  const dy = H * 0.68;
  const dr = r * 0.75;
  ctx.globalAlpha = 0.35 + 0.65 * bal;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(cx, dy, dr, dr * 0.35, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#3d7dff";
  ctx.beginPath();
  ctx.arc(cx + Math.cos(state.drum) * dr, dy + Math.sin(state.drum) * dr * 0.35, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.font = "8px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = brake ? "#ff3b30" : fast ? "#ff6a1a" : "#ffffff";
  ctx.fillText(brake ? "STOP" : fast ? "FAST" : "SLOW", 4, 10);
  ctx.textAlign = "right";
  ctx.fillStyle = "#6b6b6b";
  ctx.fillText("HORN", W - 4, 10);
  ctx.fillText("DRUM", W - 4, H - 4);
}

export default { tone_screen, leslie_screen };
