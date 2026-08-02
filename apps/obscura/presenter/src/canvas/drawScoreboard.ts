import type { CharState } from "../types/game";
import { drawCharacter } from "./drawCharacter";
import { F, glowText } from "./drawHelpers";

export const drawScoreboard = (
  ctx: CanvasRenderingContext2D,
  W: number,
  _H: number,
  startY: number,
  maxH: number,
  sortedPlayers: { name: string; score: number }[],
  charStates: Map<string, CharState>,
) => {
  const maxScore = Math.max(1, sortedPlayers[0]?.score ?? 1);

  const rowH = Math.min(52, maxH / Math.max(sortedPlayers.length, 1));
  const barMaxW = W * 0.32;
  const barH = Math.min(20, rowH * 0.45);
  const charAreaX = W * 0.12;
  const nameX = W * 0.22;
  const barX = W * 0.48;
  const scoreX = W * 0.84;

  for (let i = 0; i < sortedPlayers.length; i++) {
    const p = sortedPlayers[i];
    const rowY = startY + i * rowH;

    // Mini character (static pose)
    const cs = charStates.get(p.name);
    if (cs) {
      const savedX = cs.x;
      const savedPhase = cs.legPhase;
      cs.x = charAreaX;
      cs.legPhase = 0;
      drawCharacter(ctx, "", 0, cs, rowY + rowH * 0.35, 0.55);
      cs.x = savedX;
      cs.legPhase = savedPhase;
    }

    // Player name
    const nameColor = i === 0 ? "#ffff00" : "#00ffff";
    glowText(
      ctx,
      p.name.toUpperCase(),
      nameX,
      rowY + rowH * 0.5,
      nameColor,
      i === 0 ? 12 : 6,
      F(Math.min(13, Math.floor(rowH * 0.28))),
      "left",
    );

    // Progress bar
    const barW = (p.score / maxScore) * barMaxW;
    const barY = rowY + (rowH - barH) / 2;
    ctx.save();
    ctx.strokeStyle = "#ff00ff";
    ctx.lineWidth = 1;
    ctx.shadowColor = "#ff00ff";
    ctx.shadowBlur = 4;
    ctx.strokeRect(barX, barY, barMaxW, barH);
    if (barW > 0) {
      const barColor = i === 0 ? "#ffff00" : "#ff00ff";
      ctx.fillStyle = barColor;
      ctx.shadowColor = barColor;
      ctx.shadowBlur = 8;
      ctx.fillRect(barX + 1, barY + 1, barW - 2, barH - 2);
    }
    ctx.restore();

    // Score number
    glowText(
      ctx,
      `${p.score}`,
      scoreX,
      rowY + rowH * 0.5,
      i === 0 ? "#ffff00" : "#ff00ff",
      6,
      F(Math.min(14, Math.floor(rowH * 0.3))),
      "left",
    );
  }
};
