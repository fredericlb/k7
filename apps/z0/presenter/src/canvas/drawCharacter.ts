import type { CharFeatures, CharState } from "../types/game";

const CHAR_BODY_COLORS = [
  "#ff6600",
  "#00ffff",
  "#ffff00",
  "#ff00ff",
  "#00ff88",
  "#ff4488",
];
const CHAR_HAT_COLORS = ["#ffff00", "#ff00ff", "#00ffff", "#ffffff", "#ff8800"];
const CHAR_EYE_COLORS = ["#ffffff", "#00ffff", "#ffff00", "#00ff88"];
const CHAR_SKIN_TONES = ["#ffcc99", "#f0aa70", "#cc8844", "#a06030", "#ffe0b8"];

export const fnv1a = (str: string): number => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
};

export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const genCharFeatures = (name: string): CharFeatures => {
  const rng = mulberry32(fnv1a(name));
  return {
    bodyColor: CHAR_BODY_COLORS[Math.floor(rng() * CHAR_BODY_COLORS.length)],
    skinColor: CHAR_SKIN_TONES[Math.floor(rng() * CHAR_SKIN_TONES.length)],
    eyeColor: CHAR_EYE_COLORS[Math.floor(rng() * CHAR_EYE_COLORS.length)],
    hatType: Math.floor(rng() * 4),
    hatColor: CHAR_HAT_COLORS[Math.floor(rng() * CHAR_HAT_COLORS.length)],
  };
};

// Approximate drawn height of the character at scale 1 (baseY at feet,
// hat top reaches roughly y = -120). Used by callers to map score → scale.
export const CHAR_BASE_HEIGHT = 120;

// Linear scale from 1 (no points) up to a max where the character occupies
// half the canvas height when score equals totalSongs * 1000 (a perfect game).
export const charScaleForScore = (
  score: number,
  totalSongs: number,
  canvasHeight: number,
): number => {
  if (totalSongs <= 0 || canvasHeight <= 0) return 1;
  const maxScore = totalSongs * 1000;
  const sMax = canvasHeight / 2 / CHAR_BASE_HEIGHT;
  const ratio = Math.max(0, Math.min(1, score / maxScore));
  return 1 + (sMax - 1) * ratio;
};

export const drawCharacter = (
  ctx: CanvasRenderingContext2D,
  name: string,
  _score: number,
  cs: CharState,
  baseY: number,
  scale: number,
) => {
  const s = scale;
  const { bodyColor, skinColor, eyeColor, hatType, hatColor } = cs.features;
  const swing = Math.sin(cs.legPhase) * 14 * s;

  ctx.save();
  ctx.translate(cs.x, baseY);

  // Ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, 2, 18 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 5 * s;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-8 * s, -26 * s);
  ctx.lineTo(-8 * s + swing, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(8 * s, -26 * s);
  ctx.lineTo(8 * s - swing, 0);
  ctx.stroke();

  // Body
  ctx.fillStyle = bodyColor;
  ctx.shadowColor = bodyColor;
  ctx.shadowBlur = 8 * s;
  ctx.beginPath();
  ctx.ellipse(0, -46 * s, 17 * s, 22 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Arms
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 4 * s;
  ctx.beginPath();
  ctx.moveTo(-15 * s, -52 * s);
  ctx.lineTo(-26 * s + swing * 0.5, -38 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(15 * s, -52 * s);
  ctx.lineTo(26 * s - swing * 0.5, -38 * s);
  ctx.stroke();

  // Head
  ctx.fillStyle = skinColor;
  ctx.shadowColor = skinColor;
  ctx.shadowBlur = 5 * s;
  ctx.beginPath();
  ctx.arc(0, -78 * s, 15 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Eyes
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(-5.5 * s, -80 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(5.5 * s, -80 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(-5.5 * s, -80 * s, 1.4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(5.5 * s, -80 * s, 1.4 * s, 0, Math.PI * 2);
  ctx.fill();

  // Hat
  ctx.fillStyle = hatColor;
  ctx.strokeStyle = hatColor;
  ctx.shadowColor = hatColor;
  ctx.shadowBlur = 8 * s;
  if (hatType === 1) {
    ctx.fillRect(-12 * s, -97 * s, 24 * s, 10 * s);
    ctx.fillRect(-9 * s, -118 * s, 18 * s, 23 * s);
  } else if (hatType === 2) {
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(0, -92 * s);
    ctx.lineTo(0, -115 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -119 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
  } else if (hatType === 3) {
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 7 * s - 4 * s, -90 * s);
      ctx.lineTo(i * 7 * s, -112 * s + Math.abs(i) * 3 * s);
      ctx.lineTo(i * 7 * s + 4 * s, -90 * s);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;

  // Name label
  const fontSize = Math.max(7, Math.round(8 * s));
  ctx.font = `${fontSize}px 'Press Start 2P', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = bodyColor;
  ctx.shadowColor = bodyColor;
  ctx.shadowBlur = 5;
  ctx.fillText(name.toUpperCase().slice(0, 9), 0, 9 * s);
  ctx.shadowBlur = 0;

  ctx.restore();
};
