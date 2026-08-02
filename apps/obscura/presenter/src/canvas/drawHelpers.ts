import type { GlitchState, Particle } from "../types/game";

export const F = (size: number) => `${size}px 'Press Start 2P', monospace`;

export const glowText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  blur: number,
  font: string,
  align: CanvasTextAlign = "center",
) => {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillText(text, x, y);
  ctx.restore();
};

export const drawButton = (
  ctx: CanvasRenderingContext2D,
  id: string,
  label: string,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
  hoverButton: string,
  buttonRects: Record<string, [number, number, number, number]>,
) => {
  const hover = hoverButton === id;
  const s = hover ? 1.06 : 1.0;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = hover ? 22 : 10;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = color + "22";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.font = F(14);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.shadowBlur = 8;
  ctx.fillText(label, 0, 0);
  ctx.restore();
  buttonRects[id] = [cx - w / 2, cy - h / 2, w, h];
};

export const drawGrid = (
  ctx: CanvasRenderingContext2D,
  W: number,
  _H: number,
  sceneH: number,
) => {
  ctx.save();
  ctx.strokeStyle = "rgba(255,0,255,0.15)";
  ctx.lineWidth = 1;

  const tvpX = W / 2;
  const tvpY = sceneH * 0.04;
  const tBase = sceneH * 0.38;
  const tHalf = W * 0.65;

  for (let i = 0; i <= 14; i++) {
    const t = (i / 14) ** 1.6;
    const y = tvpY + (tBase - tvpY) * t;
    const hw = tHalf * t;
    ctx.beginPath();
    ctx.moveTo(tvpX - hw, y);
    ctx.lineTo(tvpX + hw, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 20; i++) {
    const bx = tvpX - tHalf + i * ((tHalf * 2) / 20);
    ctx.beginPath();
    ctx.moveTo(tvpX, tvpY);
    ctx.lineTo(bx, tBase);
    ctx.stroke();
  }

  const bvpX = W / 2;
  const bvpY = sceneH * 0.68;
  const bBase = sceneH * 1.02;
  const bHalf = W * 0.65;

  for (let i = 0; i <= 14; i++) {
    const t = (i / 14) ** 1.6;
    const y = bvpY + (bBase - bvpY) * t;
    const hw = bHalf * t;
    ctx.beginPath();
    ctx.moveTo(bvpX - hw, y);
    ctx.lineTo(bvpX + hw, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 20; i++) {
    const bx = bvpX - bHalf + i * ((bHalf * 2) / 20);
    ctx.beginPath();
    ctx.moveTo(bvpX, bvpY);
    ctx.lineTo(bx, bBase);
    ctx.stroke();
  }

  ctx.restore();
};

export const drawParticles = (
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  _W: number,
  sceneH: number,
  dt: number,
) => {
  ctx.save();
  ctx.fillStyle = "#00ffff";
  ctx.shadowColor = "#00ffff";
  ctx.shadowBlur = 4;
  ctx.globalAlpha = 0.75;
  for (const p of particles) {
    p.y -= p.speed * dt * 60;
    if (p.y < 0) p.y += sceneH;
    ctx.fillRect(p.x, p.y, 2, 2);
  }
  ctx.restore();
};

export const drawCorners = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  opacity: number,
) => {
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = "#ff00ff";
  ctx.lineWidth = 2;
  ctx.shadowColor = "#ff00ff";
  ctx.shadowBlur = 6;
  const s = 56,
    p = 28;
  const draw = (
    x1: number,
    y1: number,
    xc: number,
    yc: number,
    x2: number,
    y2: number,
  ) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(xc, yc);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  draw(p + s, p, p, p, p, p + s);
  draw(W - p - s, p, W - p, p, W - p, p + s);
  draw(p + s, H - p, p, H - p, p, H - p - s);
  draw(W - p - s, H - p, W - p, H - p, W - p, H - p - s);
  ctx.restore();
};

export const drawPlayerBox = (
  ctx: CanvasRenderingContext2D,
  name: string,
  cx: number,
  cy: number,
  gs: GlitchState,
  buzzing = false,
) => {
  const w = 160,
    h = 52;
  const x = cx + (gs.active ? gs.ox : 0);
  const y = cy + (gs.active ? gs.oy : 0);
  const scale = buzzing ? 1.12 : 1;
  ctx.save();
  ctx.translate(x, y);
  if (buzzing) ctx.scale(scale, scale);
  const borderColor = buzzing ? "#00ff88" : "#ff00ff";
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = buzzing ? 3 : 1.5;
  ctx.shadowColor = borderColor;
  ctx.shadowBlur = buzzing ? 28 : 10;
  ctx.fillStyle = buzzing ? "rgba(0,255,136,0.18)" : "rgba(255,255,255,0.06)";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.font = F(11);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = buzzing ? "#00ff88" : "#ff00ff";
  ctx.shadowBlur = buzzing ? 20 : 8;
  let label = name.toUpperCase();
  while (ctx.measureText(label).width > w - 16 && label.length > 1)
    label = label.slice(0, -1);
  ctx.fillText(label, 0, 0);
  ctx.restore();
};

export const drawCategoryName = (
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxW: number,
) => {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ff00ff";
  ctx.shadowColor = "#ff00ff";
  ctx.shadowBlur = 22;
  let size = 58;
  ctx.font = F(size);
  while (ctx.measureText(text).width > maxW && size > 12) {
    size -= 3;
    ctx.font = F(size);
  }
  ctx.fillText(text, cx, cy);
  ctx.restore();
};

export const drawMusicNote = (
  ctx: CanvasRenderingContext2D,
  symbol: string,
  cx: number,
  cy: number,
  color: string,
  phase: number,
) => {
  const bob = Math.sin(phase) * 26;
  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.rotate(Math.sin(phase * 0.6) * 0.14);
  ctx.font = "68px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.fillText(symbol, 0, 0);
  ctx.restore();
};

const NOTE_SYMBOLS = ["♪", "♫", "♩", "♬"];
const NOTE_COLORS = [
  "#ff00ff",
  "#00ffff",
  "#ffff00",
  "#00ff88",
  "#ff4488",
  "#8844ff",
];

// Pre-computed note field (deterministic from seed)
let _noteField:
  | {
      x: number;
      y: number;
      symbol: string;
      color: string;
      size: number;
      speedMul: number;
      phaseMul: number;
    }[]
  | null = null;
const NOTE_COUNT = 18;

const ensureNoteField = () => {
  if (_noteField) return _noteField;
  _noteField = [];
  // Simple seeded pseudo-random
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < NOTE_COUNT; i++) {
    _noteField.push({
      x: 0.05 + rand() * 0.9, // 5%-95% of W
      y: 0.08 + rand() * 0.7, // 8%-78% of H
      symbol: NOTE_SYMBOLS[Math.floor(rand() * NOTE_SYMBOLS.length)],
      color: NOTE_COLORS[Math.floor(rand() * NOTE_COLORS.length)],
      size: 22 + Math.floor(rand() * 40),
      speedMul: 0.6 + rand() * 1.4,
      phaseMul: rand() * Math.PI * 2,
    });
  }
  return _noteField;
};

export const drawNoteField = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  phase: number,
  speedFactor = 1,
) => {
  const notes = ensureNoteField();
  for (const n of notes) {
    const p = phase * n.speedMul * speedFactor + n.phaseMul;
    const bob = Math.sin(p) * 18;
    const drift = Math.sin(p * 0.7 + 1.3) * 12;
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(p * 0.5) * 0.15;
    ctx.translate(n.x * W + drift, n.y * H + bob);
    ctx.rotate(Math.sin(p * 0.4) * 0.2);
    ctx.font = `${n.size}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = n.color;
    ctx.shadowColor = n.color;
    ctx.shadowBlur = 12;
    ctx.fillText(n.symbol, 0, 0);
    ctx.restore();
  }
};

export const drawSpinner = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
) => {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = "#ff00ff";
  ctx.lineWidth = 6;
  ctx.shadowColor = "#ff00ff";
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, Math.PI * 1.7);
  ctx.stroke();
  ctx.restore();
};

export const drawReloadIcon = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  hover: boolean,
) => {
  const s = hover ? 1.06 : 1.0;
  const r = 13;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = hover ? 18 : 10;

  const startA = Math.PI / 6;
  const endA = startA + Math.PI * (300 / 180);
  ctx.beginPath();
  ctx.arc(0, 0, r, startA, endA, false);
  ctx.stroke();

  const ex = Math.cos(endA) * r;
  const ey = Math.sin(endA) * r;
  const atx = Math.sin(endA);
  const aty = -Math.cos(endA);
  const aLen = r * 0.55;
  const sp = 0.55;
  ctx.beginPath();
  ctx.moveTo(
    ex + (atx * Math.cos(sp) - aty * Math.sin(sp)) * aLen,
    ey + (atx * Math.sin(sp) + aty * Math.cos(sp)) * aLen,
  );
  ctx.lineTo(ex, ey);
  ctx.lineTo(
    ex + (atx * Math.cos(-sp) - aty * Math.sin(-sp)) * aLen,
    ey + (atx * Math.sin(-sp) + aty * Math.cos(-sp)) * aLen,
  );
  ctx.stroke();

  ctx.restore();
};
