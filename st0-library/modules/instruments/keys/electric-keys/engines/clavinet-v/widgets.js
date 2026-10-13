// clavinet-v screens: the tone the rocker switches and the mute carve, and the vocal filter's A-E-I-O-U pad.
const BLUE = "#3d7dff", GREEN = "#3ec96b", WHITE = "#ffffff", ORANGE = "#ff6a1a", GREY = "#6b6b6b";
const FONT = "8px ui-monospace, monospace";
const BIG = "bold 16px ui-monospace, monospace";
const VOWELS = ["A", "E", "I", "O", "U"];

function text(ctx, s, x, y, c, align, font) {
  ctx.fillStyle = c;
  ctx.font = font || FONT;
  ctx.textAlign = align || "left";
  ctx.fillText(s, x, y);
}

const on = (v) => (v ?? 0) >= 0.5;
const lp = (f, fc) => 1 / Math.sqrt(1 + Math.pow(f / fc, 2));
const hp = (f, fc) => 1 / Math.sqrt(1 + Math.pow(fc / f, 2));

export default {
  tone_screen(lcd) {
    const { ctx, width: W, height: H, params: p, output } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const br = on(p["Tone Brillant"]), tr = on(p["Tone Treble"]), md = on(p["Tone Medium"]), sf = on(p["Tone Soft"]);
    const mute = p["Mute"] ?? 0;
    const resp = (f) => {
      let m = 1;
      if (br) m *= hp(f, 900);
      if (tr) m *= hp(f, 300);
      if (md) m *= 0.4 + 0.6 * Math.exp(-Math.pow(Math.log2(f / 900), 2));
      if (sf) m *= lp(f, 1200);
      m *= lp(f, 12000 * Math.pow(0.03, mute));
      return 20 * Math.log10(Math.max(m, 1e-4));
    };
    const top = 30, bot = H - 12;
    const y = (d) => top + (Math.min(0, Math.max(-36, d)) / -36) * (bot - top);
    ctx.strokeStyle = "#1a1a1a";
    ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(W, y(0)); ctx.stroke();
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const f = 40 * Math.pow(400, x / W), yy = y(resp(f));
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
    ctx.fillStyle = "#ff6a1a40";
    ctx.beginPath();
    ctx.moveTo(0, bot);
    for (let x = 0; x <= W; x += 2) ctx.lineTo(x, y(resp(40 * Math.pow(400, x / W))));
    ctx.lineTo(W, bot);
    ctx.closePath();
    ctx.fill();
    const lights = [["BRILL", br], ["TREB", tr], ["MED", md], ["SOFT", sf]];
    lights.forEach(([s, lit], i) => text(ctx, s, 4 + i * 34, 9, lit ? ORANGE : GREY));
    const ab = on(p["Pickup A/B Switch"]) ? "B" : "A", cd = on(p["Pickup C/D Switch"]) ? "D" : "C";
    text(ctx, ab + cd, W - 4, 22, WHITE, "right", BIG);
    if (mute > 0.02) {
      ctx.fillStyle = BLUE;
      ctx.fillRect(4, 14, Math.max(2, mute * 60), 3);
      text(ctx, "MUTE", 68, 19, BLUE);
    }
    let lv = 0;
    if (output && output.length) for (let i = Math.max(0, output.length - 16); i < output.length; i++) lv = Math.max(lv, output[i] || 0);
    if (lv > 0.001) { ctx.fillStyle = GREEN; ctx.fillRect(W - 3, bot - lv * (bot - top), 2, lv * (bot - top)); }
    text(ctx, "LOW", 4, H - 2, GREY);
    text(ctx, "HIGH", W - 4, H - 2, GREY, "right");
  },

  vowel_screen(lcd) {
    const { ctx, width: W, height: H, params: p, now } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const live = on(p["Vocal Filter On/Off"]);
    const lfo = on(p["Vocal Filter LFO On/Off"]);
    const pad = 10, pw = W - pad * 2, ph = H - pad * 2 - 4;
    const pts = VOWELS.map((v, i) => {
      const dx = [0.15, 0.31, 0.73, 0.87, 0.48][i], dy = [0.65, 0.25, 0.23, 0.73, 0.85][i];
      return [pad + (p[`${v} Position X`] ?? dx) * pw, pad + 4 + (1 - (p[`${v} Position Y`] ?? dy)) * ph];
    });
    ctx.strokeStyle = "#1a1a1a";
    ctx.strokeRect(pad + 0.5, pad + 4.5, pw, ph);
    ctx.strokeStyle = live ? WHITE : GREY;
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach(([x, yy], i) => (i === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy)));
    ctx.closePath();
    ctx.stroke();
    pts.forEach(([x, yy], i) => {
      ctx.fillStyle = live ? BLUE : GREY;
      ctx.beginPath(); ctx.arc(x, yy, 3, 0, 2 * Math.PI); ctx.fill();
      text(ctx, VOWELS[i], x + 5, yy - 3, live ? WHITE : GREY);
    });
    if (live && lfo) {
      const rate = 0.1 + (p["Vocal Filter LFO rate"] ?? 0.6) * 2;
      const t = ((((now || 0) / 1000) * rate) % 1 + 1) % 1;
      const seg = t * 5, k = Math.min(4, Math.floor(seg)), f = seg - k;
      const a = pts[k], b = pts[(k + 1) % 5];
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.arc(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 4, 0, 2 * Math.PI); ctx.fill();
    }
    text(ctx, live ? (lfo ? "VOCAL LFO" : "VOCAL") : "VOCAL OFF", 4, 9, live ? WHITE : GREY);
  },
};
