// stage-73-v2 screens: the tine swinging past its pickup with the wave it makes, and the stereo vibrato.
const FONT = "8px ui-monospace, monospace";
const BLUE = "#3d7dff";
const GREEN = "#3ec96b";
const ORANGE = "#ff6a1a";
const WHITE = "#ffffff";
const GREY = "#6b6b6b";

function clamp01(v) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function last(arr) {
  return Array.isArray(arr) && arr.length > 0 ? clamp01(arr[arr.length - 1] ?? 0) : 0;
}

export default {
  pickup_screen(lcd) {
    const { ctx, width: W, height: H, params, output, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    const hard = clamp01(params["Hammer Hardness"] ?? 0.65);
    const dist = clamp01(params["Pickup Distance"] ?? 0.42);
    const align = clamp01(params["Pickup Alignment"] ?? 0.6);
    const level = last(output);
    const t = (now ?? 0) / 1000;
    // Top half: the tine, its swing, and the pickup coil set back by distance and offset by alignment.
    const mid = H * 0.3;
    const tipX = W * 0.55;
    const swing = (0.25 + level * 0.75) * H * 0.12;
    const tipY = mid + Math.sin(t * 20) * (level > 0.001 ? swing : 0);
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, mid);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(tipX, mid - swing);
    ctx.lineTo(tipX, mid + swing);
    ctx.stroke();
    const coilX = tipX + 6 + dist * W * 0.3;
    const coilY = mid + (align - 0.5) * H * 0.3;
    const cw = Math.max(6, W * 0.08);
    const ch = Math.max(8, H * 0.22);
    ctx.fillStyle = BLUE;
    ctx.fillRect(coilX, coilY - ch / 2, cw, ch);
    ctx.strokeStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(10, mid - 6, 2 + hard * 4, 0, Math.PI * 2);
    ctx.stroke();
    // Bottom half: the voltage the coil sees — asymmetric as the tine sits off-axis, softer as it moves away.
    const wy = H * 0.72;
    const amp = Math.max(2, H * 0.18) * (1 - dist * 0.6);
    const off = (align - 0.5) * 2;
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    const n = 96;
    for (let i = 0; i <= n; i++) {
      const p = (i / n) * Math.PI * 6;
      const s = Math.sin(p);
      const v = s + off * 0.6 * (s * s - 0.5) + hard * 0.15 * Math.sin(3 * p);
      const x = 4 + ((W - 8) * i) / n;
      const y = wy - Math.max(-1.4, Math.min(1.4, v)) * amp * 0.75;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = ORANGE;
    ctx.fillText("HAMMER", 4, H - 3);
    ctx.fillStyle = BLUE;
    ctx.textAlign = "right";
    ctx.fillText("PICKUP", W - 4, H - 3);
    ctx.textAlign = "left";
  },

  vib_screen(lcd) {
    const { ctx, width: W, height: H, params, now, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    const on = (params["Preamp Vibrato On"] ?? 0) >= 0.5;
    const depth = clamp01(params["Preamp Vibrato Intensity"] ?? 0);
    const rate = clamp01(params["Preamp Vibrato Speed"] ?? 0.5);
    const cycles = 1 + rate * 5;
    const top = 12;
    const bottom = H - 12;
    const mid = (top + bottom) / 2;
    const half = Math.max(1, (bottom - top) / 2);
    const amp = on ? depth * half : 0;
    const phase = output && output.length > 0 && on ? ((now ?? 0) / 1000) * (1 + rate * 6) : 0;
    const wave = (sign, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      const n = 64;
      for (let i = 0; i <= n; i++) {
        const x = 4 + ((W - 8) * i) / n;
        const y = mid - sign * Math.sin((i / n) * cycles * Math.PI * 2 + phase) * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(4, Math.round(mid) + 0.5);
    ctx.lineTo(W - 4, Math.round(mid) + 0.5);
    ctx.stroke();
    wave(1, on ? GREEN : GREY);
    wave(-1, on ? WHITE : GREY);
    ctx.fillStyle = on ? GREEN : GREY;
    ctx.fillText("L", 4, 9);
    ctx.fillStyle = on ? WHITE : GREY;
    ctx.fillText("R", 12, 9);
    ctx.textAlign = "right";
    ctx.fillStyle = on ? WHITE : GREY;
    ctx.fillText(on ? "VIBRATO" : "VIB OFF", W - 4, 9);
    ctx.textAlign = "left";
  },
};
