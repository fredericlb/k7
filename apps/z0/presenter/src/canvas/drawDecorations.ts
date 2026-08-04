export const drawGuitar = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  wobble: number,
  exitX: number,
  opacity: number,
) => {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(cx + exitX, cy);
  ctx.rotate(wobble);
  ctx.scale(scale, scale);

  ctx.shadowColor = "rgba(180,0,60,0.35)";
  ctx.shadowBlur = 30;

  // Lower bout
  ctx.fillStyle = "#1c0b06";
  ctx.beginPath();
  ctx.ellipse(0, 30, 44, 52, 0, 0, Math.PI * 2);
  ctx.fill();
  // Upper bout
  ctx.beginPath();
  ctx.ellipse(0, -28, 33, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  // Waist fill
  ctx.fillRect(-22, -12, 44, 24);
  // Neck
  ctx.fillStyle = "#2a1305";
  ctx.fillRect(-7, -85, 14, 60);
  // Headstock
  ctx.fillStyle = "#140802";
  ctx.beginPath();
  ctx.moveTo(-10, -85);
  ctx.lineTo(-12, -133);
  ctx.lineTo(12, -133);
  ctx.lineTo(10, -85);
  ctx.closePath();
  ctx.fill();
  // Sound hole
  ctx.fillStyle = "#080003";
  ctx.beginPath();
  ctx.arc(0, 14, 14, 0, Math.PI * 2);
  ctx.fill();
  // Strings
  ctx.globalAlpha = opacity * 0.28;
  ctx.strokeStyle = "#c8c398";
  ctx.lineWidth = 0.6;
  for (let i = -2; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 2.2, -40);
    ctx.lineTo(i * 2.2, 86);
    ctx.stroke();
  }
  // Tuning pegs
  ctx.globalAlpha = opacity;
  ctx.fillStyle = "#6a6a5a";
  ctx.shadowBlur = 0;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(-13, -92 - i * 13, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(13, -92 - i * 13, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
};

export const drawQuarterNote = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  bob: number,
  exitX: number,
  opacity: number,
) => {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(cx + exitX, cy + bob);
  ctx.scale(scale, scale);

  ctx.fillStyle = "#160b26";
  ctx.shadowColor = "rgba(80,0,120,0.4)";
  ctx.shadowBlur = 22;

  // Note head
  ctx.save();
  ctx.rotate(-0.32);
  ctx.scale(1.28, 0.72);
  ctx.beginPath();
  ctx.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Stem
  ctx.fillRect(12, -74, 4, 74);

  // Flag
  ctx.beginPath();
  ctx.moveTo(16, -74);
  ctx.quadraticCurveTo(50, -56, 46, -26);
  ctx.quadraticCurveTo(35, -43, 16, -36);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
};
