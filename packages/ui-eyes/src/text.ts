// text.ts — setting a block of text the way a title and a caption both need it: written line
// breaks kept, words wrapped inside a width, each line aligned, a box behind the block and a
// shadow under the glyphs when asked. The LAYOUT is pure, given a way to measure a string, so it
// is tested without a canvas; drawing it is one call. See song-video/docs/titles.md.

/** How a block is set; `x`/`y` is its top-left with a width, or the point its alignment hangs on without one. */
export interface TextBlock {
  content: string;
  font: string; // a CSS family
  fontSize: number; // px
  color: string;
  x: number;
  y: number;
  /** The width lines wrap in; absent, a line is as long as it is written. */
  w?: number;
  align?: "left" | "center" | "right";
  lineHeight?: number; // a multiple of the font size
  background?: string;
  padding?: number;
  shadow?: boolean;
  /** Which edge `y` names: the block's top, unsaid, or its bottom — what a caption sits on. */
  anchor?: "top" | "bottom" | "middle";
}

/** One line as laid out: its text and the left edge it starts at. */
export interface LaidLine {
  text: string;
  x: number;
  width: number;
}

/** Words wrapped into lines no wider than `w`, written breaks kept; a single word wider than `w` stays one line. */
export function wrapLines(
  content: string,
  w: number | undefined,
  measure: (s: string) => number,
): string[] {
  const out: string[] = [];
  for (const para of content.split(/\r?\n/)) {
    if (!w || measure(para) <= w) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > w) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** The block's lines placed, and the box around them — everything `drawText` paints, without painting. */
export function layoutText(
  b: TextBlock,
  measure: (s: string) => number,
): {
  lines: LaidLine[];
  top: number;
  step: number;
  box: [number, number, number, number];
} {
  const step = b.fontSize * (b.lineHeight ?? 1.2);
  const lines = wrapLines(b.content, b.w, measure);
  const widths = lines.map(measure);
  const widest = Math.max(0, ...widths);
  const align = b.align ?? "left";
  // With a width the block is [x, x+w]; without one, its alignment hangs on x.
  const left =
    b.w !== undefined
      ? b.x
      : align === "center"
        ? b.x - widest / 2
        : align === "right"
          ? b.x - widest
          : b.x;
  const span = b.w ?? widest;
  const height = lines.length * step;
  const top =
    b.anchor === "bottom"
      ? b.y - height
      : b.anchor === "middle"
        ? b.y - height / 2
        : b.y;
  const laid = lines.map((text, i) => {
    const width = Math.min(widths[i] as number, span);
    const x =
      align === "center"
        ? left + (span - width) / 2
        : align === "right"
          ? left + span - width
          : left;
    return { text, x, width };
  });
  // The box hugs the lines actually drawn, not the width they were wrapped in.
  const pad = b.background ? (b.padding ?? b.fontSize * 0.3) : 0;
  const x0 = Math.min(...laid.map((l) => l.x)) - pad;
  const x1 = Math.max(...laid.map((l) => l.x + l.width)) + pad;
  return {
    lines: laid,
    top,
    step,
    box: [x0, top - pad, x1 - x0, height + 2 * pad],
  };
}

/** Paint `b` onto `ctx`. */
export function drawText(
  ctx: OffscreenCanvasRenderingContext2D,
  b: TextBlock,
): void {
  ctx.save();
  ctx.font = `${b.fontSize}px ${b.font}`;
  ctx.textBaseline = "top";
  const measure = (s: string) => ctx.measureText(s).width;
  const { lines, top, step, box } = layoutText(b, measure);
  if (b.background) {
    ctx.fillStyle = b.background;
    ctx.fillRect(box[0], box[1], box[2], box[3]);
  }
  if (b.shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
    ctx.shadowBlur = b.fontSize * 0.15;
    ctx.shadowOffsetY = b.fontSize * 0.05;
  }
  ctx.fillStyle = b.color;
  // A word wider than the width is CONDENSED to it rather than spilling out, as a single line always was.
  lines.forEach((l, i) => {
    if (b.w !== undefined) ctx.fillText(l.text, l.x, top + i * step, b.w);
    else ctx.fillText(l.text, l.x, top + i * step);
  });
  ctx.restore();
}
