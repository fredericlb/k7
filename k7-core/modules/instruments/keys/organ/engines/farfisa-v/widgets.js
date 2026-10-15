// Screens for Farfisa V: the wave the drawn tabs add up to, and the tremolo's swing.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", RED = "#ff3b30", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const on = (params, name) => num(params[name], 0) >= 0.5;
const last = (arr) => (Array.isArray(arr) && arr.length ? num(arr[arr.length - 1], 0) : 0);

function glass(ctx, W, H) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  ctx.font = FONT;
  ctx.textBaseline = "top";
}

// One family's waveform at phase p (cycles): strings a saw, flute a sine, oboe and trumpet narrowing pulses.
function voice(kind, p, bright) {
  const x = p - Math.floor(p);
  if (kind === "flute") return Math.sin(x * Math.PI * 2);
  if (kind === "strings") return 1 - 2 * x;
  const w = kind === "oboe" ? 0.3 : 0.15 - bright * 0.05;
  return x < w ? 1 : -w / (1 - w);
}

const STOPS = [
  ["Strings 16", "strings", 0.5, WHITE],
  ["Strings 8", "strings", 1, WHITE],
  ["Strings 4", "strings", 2, WHITE],
  ["Flute 8", "flute", 1, BLUE],
  ["Flute 4", "flute", 2, BLUE],
  ["Oboe 8", "oboe", 1, GREEN],
  ["Trumpet 8", "trumpet", 1, ORANGE],
  ["2-2/3", "flute", 3, BLUE],
];
const FEET = [["16", 0.5], ["8", 1], ["4", 2], ["2⅔", 3]];

export default {
  voices(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    glass(ctx, W, H);
    const bright = on(params, "Brilliant") ? 1 : 0;
    const live = STOPS.filter(([name]) => on(params, name));
    const legend = 14, top = 4, bottom = H - legend - 2;
    const mid = (top + bottom) / 2, amp = Math.max(4, (bottom - top) / 2 - 2);
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    ctx.moveTo(4, mid);
    ctx.lineTo(W - 4, mid);
    ctx.stroke();
    // One cycle of the 16' pitch, so every footage fits a whole number of turns.
    const n = Math.max(2, Math.floor(W - 8));
    const ys = [];
    let peak = 0;
    for (let i = 0; i <= n; i++) {
      let y = 0;
      for (const [, kind, m] of live) y += voice(kind, (i / n) * m, bright);
      ys.push(y);
      peak = Math.max(peak, Math.abs(y));
    }
    const vib = on(params, "Vibrato On/Off") ? (num(params["Vibrato Depth"], 0) >= 0.5 ? 2 : 1) : 0;
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const wob = vib ? Math.sin((i / n) * Math.PI * 6) * vib : 0;
      const y = mid - (peak > 0 ? ys[i] / peak : 0) * amp;
      if (i === 0) ctx.moveTo(4 + i + wob, y);
      else ctx.lineTo(4 + i + wob, y);
    }
    ctx.stroke();
    // The footage strip: one column per foot, a dot per family drawn on it.
    const cw = (W - 8) / FEET.length;
    FEET.forEach(([label, m], c) => {
      const x = 4 + c * cw;
      ctx.fillStyle = GREY;
      ctx.fillText(label + "'", x, H - legend + 3);
      let k = 0;
      for (const [name, , mm, col] of STOPS) {
        if (mm !== m) continue;
        ctx.fillStyle = on(params, name) ? col : "#222";
        ctx.fillRect(x + 22 + k * 7, H - legend + 4, 5, 5);
        k++;
      }
    });
    if (!live.length) {
      ctx.fillStyle = GREY;
      ctx.fillText("NO TABS", 6, top + 2);
    }
    if (on(params, "Bass On/Off")) {
      ctx.fillStyle = BLUE;
      ctx.fillText("BASS", W - 30, top + 2);
    }
  },

  trem_wave(lcd) {
    const { ctx, width: W, height: H, params, output } = lcd;
    glass(ctx, W, H);
    const active = on(params, "Tremolo On/Off");
    const rate = clamp(num(params["Tremolo Rate"], 0.33), 0, 1);
    const sync = on(params, "Tremolo Sync");
    const mid = H / 2, amp = H * 0.38;
    const cycles = 1 + rate * 7;
    const lvl = clamp(0.4 + last(output) * 2, 0.4, 1);
    const n = Math.max(2, Math.floor(W - 8));
    // The envelope the tremolo cuts: a sine of its rate, or flat when it is off.
    const gain = (t) => (active ? 0.55 + 0.45 * Math.sin(t * cycles * Math.PI * 2) : 1);
    ctx.strokeStyle = GREY;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = Math.sin(t * Math.PI * 2 * 40) * gain(t) * amp * lvl;
      if (i === 0) ctx.moveTo(4 + i, mid - y);
      else ctx.lineTo(4 + i, mid - y);
    }
    ctx.stroke();
    ctx.strokeStyle = active ? GREEN : GREY;
    for (const s of [1, -1]) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const y = mid - s * gain(i / n) * amp * lvl;
        if (i === 0) ctx.moveTo(4 + i, y);
        else ctx.lineTo(4 + i, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = active ? GREEN : GREY;
    ctx.fillText(active ? (sync ? "TREM SYNC" : "TREM") : "TREM OFF", 4, 3);
    if (typeof params["Amp Power"] === "number" && !on(params, "Amp Power")) {
      ctx.fillStyle = RED;
      ctx.fillText("AMP OFF", Math.max(4, W - 40), 3);
    }
  },
};
