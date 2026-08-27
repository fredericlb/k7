// aspect.ts — the shapes a project's FRAME can be. `project.viewport` is a pixel size and stays
// one; this is the short list a person picks from, and the sizes each one means.
//
// Here rather than beside the graph that draws the dropdown: it is a value in project.yaml, and
// @studio/ui-chains cannot see this package. The card's options are the two names spelled again
// there, and `aspectSize` REFUSES a name it does not know — so a drift is a refusal, not a silent
// wrong size. See packages/song/docs/picture.md.

/** One frame shape: what it is called, and the pixels it means. */
export interface Aspect {
  name: string;
  w: number;
  h: number;
}

/** The shapes on offer. 1080-tall landscape and 1080-wide portrait — the two a phone and a screen
 *  actually want, and the pair every delivery target starts from. */
export const ASPECTS: readonly Aspect[] = [
  { name: "16:9", w: 1920, h: 1080 },
  { name: "9:16", w: 1080, h: 1920 },
];

/** The size a name means, or null for one that is not on the list. */
export function aspectSize(name: string): Aspect | null {
  const want = name.trim();
  return ASPECTS.find((a) => a.name === want) ?? null;
}

/**
 * Which shape a viewport IS, by ratio rather than by exact size: a project written `[1280, 720]`
 * is 16:9 as surely as `[1920, 1080]`, and the card has to tick the right row for both.
 *
 * Null when it matches none — an odd viewport is a legal thing to have authored, and the dropdown
 * shows nothing chosen rather than lying about it.
 */
export function aspectOf(w: number, h: number): Aspect | null {
  if (!(w > 0) || !(h > 0)) return null;
  const ratio = w / h;
  // A tenth of a percent: enough for 1366×768 to read as 16:9, far from letting 4:3 pass for it.
  return (
    ASPECTS.find((a) => Math.abs(ratio - a.w / a.h) < a.w / a.h / 1000) ?? null
  );
}
