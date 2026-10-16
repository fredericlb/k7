// clip — one sine cycle cut at its positive and negative ceilings; the heights are relative, not calibrated dB.
export default {
  clip(lcd) {
    const { ctx, width: W, height: H, params } = lcd;
    const clamp = (v) => Math.max(0, Math.min(1, typeof v === "number" ? v : 0.5));
    const pos = 0.15 + 0.85 * clamp(params["Pos Thr"]), neg = 0.15 + 0.85 * clamp(params["Neg Thr"]);
    const mid = H / 2, amp = Math.max(1, H / 2 - 6);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1; ctx.strokeStyle = "#6b6b6b";
    ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) { const x = (i / 96) * W, y = mid - Math.sin((i / 96) * Math.PI * 2) * amp; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = "#ff6a1a"; ctx.beginPath(); ctx.moveTo(0, mid - pos * amp); ctx.lineTo(W, mid - pos * amp); ctx.stroke();
    ctx.strokeStyle = "#3d7dff"; ctx.beginPath(); ctx.moveTo(0, mid + neg * amp); ctx.lineTo(W, mid + neg * amp); ctx.stroke();
    ctx.strokeStyle = "#ffffff"; ctx.beginPath();
    for (let i = 0; i <= 96; i++) { const x = (i / 96) * W, s = Math.sin((i / 96) * Math.PI * 2); const v = Math.max(-neg, Math.min(pos, s)); const y = mid - v * amp; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.font = "8px ui-monospace, monospace"; ctx.textBaseline = "top";
    ctx.fillStyle = "#ff6a1a"; ctx.fillText("POS", 2, 1);
    ctx.textBaseline = "bottom"; ctx.fillStyle = "#3d7dff"; ctx.fillText("NEG", 2, H - 1);
  },
};
