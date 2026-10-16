// impulse-response — the band left to the tail: a high-pass at Low Cut and a low-pass at High Cut, both at Filter Q.

const LOW = "#3ec96b";
const HIGH = "#3d7dff";
const BAND = "#ffffff";
const GRID = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const F_LO = 10;
const F_HI = 20000;
const DB_FLOOR = -36;
const DB_TOP = 12;

// The cutoffs are MIDI note numbers: 3.49 is 10 Hz and 135.08 is 20 kHz.
const noteHz = (n) => 440 * 2 ** ((n - 69) / 12);

// Second-order magnitudes at f for a corner f0 and a Q.
function lp(f, f0, q) {
  const r = f / f0;
  return 1 / Math.max(1e-9, Math.hypot(1 - r * r, r / q));
}
function hp(f, f0, q) {
  const r = f / f0;
  return (r * r) / Math.max(1e-9, Math.hypot(1 - r * r, r / q));
}

const fmtHz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(1)}K` : `${Math.round(f)}`);

export default {
  band(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.lineWidth = 1;

    const pad = 6;
    const top = 13;
    const w = Math.max(1, W - pad * 2);
    const h = Math.max(1, H - top - pad);
    const lowHz = noteHz(params["Low Cut"] ?? 3.486816406);
    const highHz = noteHz(params["High Cut"] ?? 135.0762329);
    const q = Math.max(0.1, params["Filter Q"] ?? 0.7071);
    const xOf = (f) => pad + (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * w;
    const yOf = (db) => top + ((DB_TOP - Math.max(DB_FLOOR, Math.min(DB_TOP, db))) / (DB_TOP - DB_FLOOR)) * h;

    // The 0 dB line.
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(pad, Math.round(yOf(0)) + 0.5);
    ctx.lineTo(W - pad, Math.round(yOf(0)) + 0.5);
    ctx.stroke();

    ctx.strokeStyle = BAND;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
      const f = F_LO * (F_HI / F_LO) ** (i / w);
      const mag = hp(f, lowHz, q) * lp(f, highHz, q);
      const y = yOf(20 * Math.log10(Math.max(1e-9, mag)));
      if (i === 0) ctx.moveTo(pad + i, y);
      else ctx.lineTo(pad + i, y);
    }
    ctx.stroke();

    // A dot on each corner, in its knob's colour.
    const dot = (f, color) => {
      const x = Math.max(pad, Math.min(W - pad, xOf(f)));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, yOf(0), 2.5, 0, Math.PI * 2);
      ctx.fill();
    };
    dot(lowHz, LOW);
    dot(highHz, HIGH);

    ctx.textAlign = "left";
    ctx.fillStyle = LOW;
    ctx.fillText(`${fmtHz(lowHz)} HZ`, pad, 9);
    ctx.textAlign = "right";
    ctx.fillStyle = HIGH;
    ctx.fillText(`${fmtHz(highHz)} HZ`, W - pad, 9);
  },
};
