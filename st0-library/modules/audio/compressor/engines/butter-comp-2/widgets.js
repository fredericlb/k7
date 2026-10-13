// levels — the peak level going in (grey) against coming out (green), and their difference in dB.
const FLOOR = -48;
const db = (a) => (a > 1e-5 ? 20 * Math.log10(a) : -120);
const yOf = (a, H) => { const d = Math.max(FLOOR, Math.min(0, db(a))); return H - 3 - ((d - FLOOR) / -FLOOR) * (H - 16); };
function trace(ctx, arr, n, W, H, color) {
  const len = arr.length;
  if (len < 2 || n < 2) return;
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = arr[len - n + i];
    const x = (i / (n - 1)) * W, y = yOf(typeof v === "number" ? v : 0, H);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
function meanDb(arr, k) {
  const n = Math.min(k, arr.length);
  if (n < 1) return null;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += db(typeof arr[i] === "number" ? arr[i] : 0);
  return s / n;
}
export default {
  levels(lcd) {
    const { ctx, width: W, height: H, state } = lcd;
    const input = Array.isArray(lcd.input) ? lcd.input : [], output = Array.isArray(lcd.output) ? lcd.output : [];
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#6b6b6b"; ctx.lineWidth = 1;
    for (const d of [-12, -24, -36]) { const y = H - 3 - ((d - FLOOR) / -FLOOR) * (H - 16); ctx.beginPath(); ctx.setLineDash([1, 3]); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.font = "8px ui-monospace, monospace"; ctx.textBaseline = "top";
    ctx.fillStyle = "#6b6b6b"; ctx.fillText("IN", 2, 2);
    ctx.fillStyle = "#3ec96b"; ctx.fillText("OUT", 18, 2);
    const n = Math.min(256, input.length, output.length);
    const inDb = meanDb(input, 24), outDb = meanDb(output, 24);
    if (n < 2 || inDb === null || outDb === null || inDb < FLOOR) {
      ctx.strokeStyle = "#6b6b6b"; ctx.beginPath(); ctx.moveTo(0, H - 3); ctx.lineTo(W, H - 3); ctx.stroke();
      ctx.fillStyle = "#6b6b6b"; ctx.textAlign = "right"; ctx.fillText("NO SIGNAL", W - 2, 2); ctx.textAlign = "left";
      return;
    }
    trace(ctx, input, n, W, H, "#6b6b6b");
    trace(ctx, output, n, W, H, "#3ec96b");
    const d = outDb - inDb;
    state.delta = typeof state.delta === "number" ? state.delta * 0.7 + d * 0.3 : d;
    const v = state.delta;
    ctx.fillStyle = v < -0.5 ? "#3d7dff" : "#ffffff"; ctx.textAlign = "right";
    ctx.font = "14px ui-monospace, monospace";
    ctx.fillText(`${v >= 0 ? "+" : ""}${v.toFixed(1)}`, W - 14, 1);
    ctx.font = "8px ui-monospace, monospace"; ctx.fillText("DB", W - 2, 5);
    ctx.textAlign = "left";
  },
};
