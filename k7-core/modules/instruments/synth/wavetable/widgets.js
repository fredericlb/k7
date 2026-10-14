// wavetable — the table drawn as it is played: every frame stacked behind, and in front the frame
// Position is reading, morphed between its two neighbours exactly as dsp.dsp morphs them.

const N = 2048;

export default {
  wave(lcd) {
    const { ctx, width: W, height: H, params, color } = lcd;
    const pcm = lcd.sound("Table");
    if (!pcm || pcm.length < N) {
      ctx.fillStyle = color.dim;
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText(pcm ? "no 2048-sample frame in the table" : "loading table…", 6, H / 2);
      return;
    }
    const frames = Math.floor(pcm.length / N);
    const pos = Math.min(1, Math.max(0, params.Position ?? 0)) * (frames - 1);
    const pad = 4;
    // Each frame a little higher and to the right: a stack read back to front.
    const depthX = Math.min(24, W * 0.12);
    const depthY = Math.min(18, H * 0.25);
    const w = W - pad * 2 - depthX;
    const h = H - pad * 2 - depthY;
    const path = (sample, ox, oy) => {
      ctx.beginPath();
      const step = Math.max(1, Math.floor(N / w));
      for (let i = 0; i < N; i += step) {
        const x = pad + ox + (i / N) * w;
        const y = pad + oy + h / 2 - sample(i) * (h / 2) * 0.9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    const depth = (f) => (frames > 1 ? f / (frames - 1) : 0);
    for (let f = frames - 1; f >= 0; f--) {
      const d = depth(f);
      ctx.strokeStyle = color.dim;
      ctx.globalAlpha = 0.25 + 0.35 * (1 - Math.abs(f - pos) / Math.max(1, frames));
      ctx.lineWidth = 1;
      path((i) => pcm[f * N + i], d * depthX, depthY - d * depthY);
    }
    // The frame being played, in front: the same linear morph the program makes.
    const f0 = Math.floor(pos);
    const f1 = Math.min(f0 + 1, frames - 1);
    const t = pos - f0;
    const d = depth(pos);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color.ink;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color.glow;
    ctx.shadowBlur = 4;
    path((i) => pcm[f0 * N + i] * (1 - t) + pcm[f1 * N + i] * t, d * depthX, depthY - d * depthY);
    ctx.shadowBlur = 0;
    ctx.fillStyle = color.dim;
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText(`${(pos + 1).toFixed(1)} / ${frames}`, W - 44, H - 4);
  },
};
