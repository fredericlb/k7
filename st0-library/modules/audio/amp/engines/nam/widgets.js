const IN_COLOR = "#3d7dff";
const OUT_COLOR = "#3ec96b";
const FONT = "8px ui-monospace, monospace";

function envelope(ctx, data, len, x0, w, mid, half, color, fill) {
  if (!data || data.length === 0) return;
  const step = w / (len - 1 || 1);
  const offset = len - data.length;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = x0 + (offset + i) * step;
    const v = Math.min(1, Math.max(0, data[i] ?? 0)) * half;
    if (i === 0) ctx.moveTo(x, mid - v);
    else ctx.lineTo(x, mid - v);
  }
  for (let i = data.length - 1; i >= 0; i--) {
    const x = x0 + (offset + i) * step;
    const v = Math.min(1, Math.max(0, data[i] ?? 0)) * half;
    ctx.lineTo(x, mid + v);
  }
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function db(v) {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}dB`;
}

function screen(lcd) {
  const { ctx, width: W, height: H, params, input, output, color } = lcd;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.textBaseline = "alphabetic";

  const x0 = 4;
  const w = Math.max(1, W - 8);
  const top = 14;
  const bottom = H - 14;
  const mid = (top + bottom) / 2;
  const half = Math.max(1, (bottom - top) / 2);

  // Centre line, then input under output so the processed signal reads on top.
  ctx.strokeStyle = "#6b6b6b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, Math.round(mid) + 0.5);
  ctx.lineTo(x0 + w, Math.round(mid) + 0.5);
  ctx.stroke();

  const inp = Array.isArray(input) ? input : [];
  const out = Array.isArray(output) ? output : [];
  const len = Math.max(inp.length, out.length);
  if (len > 0) {
    envelope(ctx, inp, len, x0, w, mid, half, IN_COLOR, true);
    envelope(ctx, out, len, x0, w, mid, half, OUT_COLOR, false);
  } else {
    ctx.fillStyle = color.dim;
    ctx.textAlign = "center";
    ctx.fillText("NO AUDIO", W / 2, mid - 4);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = IN_COLOR;
  ctx.fillText("IN", 4, 10);
  ctx.fillStyle = OUT_COLOR;
  ctx.fillText("OUT", 22, 10);

  // The levels are the engine's own stage now, drawn in the card's footer; the plugin's are held.
  const gainIn = params["@input-volume"] ?? 0;
  const gainOut = params["@output-volume"] ?? 0;
  const norm = (params["Normalize"] ?? 1) >= 0.5;
  ctx.fillStyle = IN_COLOR;
  ctx.fillText(`IN ${db(gainIn)}`, 4, H - 4);
  ctx.fillStyle = OUT_COLOR;
  ctx.textAlign = "center";
  ctx.fillText(`OUT ${db(gainOut)}`, W / 2, H - 4);
  ctx.fillStyle = norm ? "#ffffff" : "#6b6b6b";
  ctx.textAlign = "right";
  ctx.fillText(`NORM ${norm ? "ON" : "OFF"}`, W - 4, H - 4);
  ctx.textAlign = "left";
}

export default {
  screen,
  screen_wide: screen,
  // Only the knobs the loaded model was trained with; none (a .nam) gives the screen the whole width.
  visible({ ampModel }) {
    // No model read yet (none loaded, the builder's preview): the knob layout, every knob shown.
    if (!ampModel) return { screen_wide: false };
    const n = ampModel.knobs;
    return {
      knobs: n > 0,
      knob_1: n >= 1,
      knob_2: n >= 2,
      knob_3: n >= 3,
      screen: n > 0,
      screen_wide: n === 0,
    };
  },
};
