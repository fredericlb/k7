// u-law-encode screens — the fixed mu-law curve (mu = 255) this module applies, with the live peak riding it.
const FONT = "8px ui-monospace, monospace";
const MU = 255;
const encode = (x) => Math.log(1 + MU * x) / Math.log(1 + MU);
const decode = (y) => (Math.pow(1 + MU, y) - 1) / MU;

export default {
  law_screen(lcd) {
    const { ctx, width: W, height: H, input } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const curve = encode;
    const pad = 4;
    const w = Math.max(1, W - 2 * pad);
    const h = Math.max(1, H - 2 * pad - 8);
    const X = (v) => pad + v * w;
    const Y = (v) => H - pad - v * h;
    ctx.strokeStyle = "#6b6b6b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(1), Y(1));
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const v = i / 64;
      if (i === 0) ctx.moveTo(X(v), Y(curve(v))); else ctx.lineTo(X(v), Y(curve(v)));
    }
    ctx.stroke();
    const last = input && input.length ? input[input.length - 1] : null;
    if (typeof last === "number" && isFinite(last)) {
      const v = Math.min(1, Math.max(0, last));
      ctx.fillStyle = "#ff6a1a";
      ctx.fillRect(X(v) - 2, Y(curve(v)) - 2, 4, 4);
    }
    ctx.font = FONT;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("MU-LAW ENCODE", pad, 9);
  },
};
