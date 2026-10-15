// adt — the two taps against the dry signal: where each sits in time, and how loud it plays.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default {
  taps_screen(lcd) {
    const { ctx, width: W, height: H, params, output, state } = lcd;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const pad = 10;
    const base = H - 14;
    const top = 12;
    const span = Math.max(1, W - pad * 2);
    const tall = Math.max(1, base - top);

    // The blend is the engine's @mix, on the equal-power curve it applies: all wet when unset.
    const mix = clamp01(params["@mix"] ?? 1);
    const wet = Math.sin((mix * Math.PI) / 2);
    const dry = Math.cos((mix * Math.PI) / 2);

    // The time axis, with a faint tick every tenth.
    ctx.strokeStyle = "#6b6b6b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, base + 0.5);
    ctx.lineTo(W - pad, base + 0.5);
    for (let i = 1; i < 10; i++) {
      const x = Math.round(pad + (span * i) / 10) + 0.5;
      ctx.moveTo(x, base);
      ctx.lineTo(x, base + 3);
    }
    ctx.stroke();

    // The dry signal: a white bar at time zero.
    const bar = (x, level, color, name) => {
      const h = Math.max(1, tall * clamp01(level));
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x) - 3, base - h, 6, h);
      ctx.fillStyle = color;
      ctx.font = "8px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(name, Math.round(x), base + 11);
    };
    bar(pad + 3, dry, "#ffffff", "DRY");

    // Each tap at its delay, as loud as its level times the wet side of the blend.
    const aTime = clamp01(params["A Delay"] ?? 0.3);
    const bTime = clamp01(params["B Delay"] ?? 0.6);
    const aLevel = clamp01(params["A Level"] ?? 0.7) * wet;
    const bLevel = clamp01(params["B Level"] ?? 0.7) * wet;
    bar(pad + 3 + (span - 6) * aTime, aLevel, "#3d7dff", "A");
    bar(pad + 3 + (span - 6) * bTime, bLevel, "#3ec96b", "B");

    // The output, smoothed: a thin orange line across the top that swells with what leaves.
    const out = output.length ? clamp01(output[output.length - 1]) : 0;
    state.out = (state.out ?? 0) * 0.7 + out * 0.3;
    if (state.out > 0.01) {
      ctx.fillStyle = "#ff6a1a";
      ctx.fillRect(pad, 4, span * state.out, 2);
    }

    ctx.fillStyle = "#6b6b6b";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText("TAPS", W - pad, 10);
  },
};
