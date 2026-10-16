// de-rez-2 screens — a sine through the crusher: Rate thins the samples held, Rez coarsens the steps.
const FONT = "8px ui-monospace, monospace";

export default {
  rez_screen(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const rate = Math.min(1, Math.max(0, params["Rate"] ?? 1));
    const rez = Math.min(1, Math.max(0, params["Rez"] ?? 1));
    // DeRez2 keeps rate^3 of the samples and quantizes to steps of (1 - rez)^3 / 3.
    const keep = Math.max(0.0005, Math.pow(rate, 3));
    const step = Math.pow(1 - rez, 3) / 3;
    const mid = H / 2;
    const amp = Math.max(1, H / 2 - 10);
    const cycles = 2;
    const n = Math.max(2, Math.round(W));
    ctx.strokeStyle = "#6b6b6b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * W;
      const y = mid - Math.sin((i / n) * cycles * 2 * Math.PI) * amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const period = Math.max(1, 1 / keep);
    const samples = 64;
    ctx.strokeStyle = "#ff6a1a";
    ctx.beginPath();
    let held = 0;
    let acc = period;
    for (let i = 0; i <= n; i++) {
      if (acc >= period) {
        acc -= period;
        const v = Math.sin((i / n) * cycles * 2 * Math.PI);
        held = step > 0.0001 ? Math.round(v / step) * step : v;
      }
      acc += samples / n;
      const x = (i / n) * W;
      const y = mid - Math.max(-1, Math.min(1, held)) * amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = FONT;
    ctx.fillText("RATE " + Math.round(rate * 100) + "  REZ " + Math.round(rez * 100), 3, 9);
  },
};
