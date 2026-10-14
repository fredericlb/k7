// compressor — the transfer curve from Threshold and Ratio (Ratio is the output slope above threshold, 0 = limit), and the live level on it.
const FLOOR = -48;
const db = (a) => (a > 1e-5 ? 20 * Math.log10(a) : -120);
const lin = (d) => Math.pow(10, d / 20);
const last = (arr) => (Array.isArray(arr) && arr.length && typeof arr[arr.length - 1] === "number" ? arr[arr.length - 1] : null);
export default {
  curve(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    const thr = Math.max(0.01, Math.min(1, params["Threshold"] ?? 0.5011872053));
    const r = Math.max(0, Math.min(0.95, params["Ratio"] ?? 0.5));
    const S = Math.max(10, Math.min(W, H) - 4), ox = 2, oy = 2;
    const px = (d) => ox + ((Math.max(FLOOR, Math.min(0, d)) - FLOOR) / -FLOOR) * S;
    const py = (d) => oy + S - ((Math.max(FLOOR, Math.min(0, d)) - FLOOR) / -FLOOR) * S;
    const shape = (a) => (a <= thr ? a : thr + (a - thr) * r);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#6b6b6b"; ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, S, S);
    ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(px(FLOOR), py(FLOOR)); ctx.lineTo(px(0), py(0)); ctx.stroke();
    const tx = px(db(thr));
    ctx.strokeStyle = "#ff6a1a"; ctx.beginPath(); ctx.moveTo(tx + 0.5, oy); ctx.lineTo(tx + 0.5, oy + S); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#3d7dff"; ctx.beginPath();
    for (let i = 0; i <= 64; i++) { const d = FLOOR + (i / 64) * -FLOOR; const x = px(d), y = py(db(shape(lin(d)))); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    const a = last(lcd.input), b = last(lcd.output);
    if (a !== null && b !== null && db(a) > FLOOR) { ctx.fillStyle = "#3ec96b"; ctx.beginPath(); ctx.arc(px(db(a)), py(db(b)), 3, 0, Math.PI * 2); ctx.fill(); }
    const tx0 = ox + S + 8;
    ctx.font = "8px ui-monospace, monospace"; ctx.textBaseline = "top";
    ctx.fillStyle = "#ff6a1a"; ctx.fillText("THR", tx0, 4);
    ctx.font = "14px ui-monospace, monospace"; ctx.fillText(`${db(thr).toFixed(1)}`, tx0, 14);
    ctx.font = "8px ui-monospace, monospace"; ctx.fillStyle = "#3d7dff"; ctx.fillText("RATIO", tx0, 36);
    ctx.font = "14px ui-monospace, monospace"; ctx.fillText(r > 0.001 ? `${(1 / r).toFixed(1)}:1` : "INF:1", tx0, 46);
  },
};
