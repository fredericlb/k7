// useCentredFits.ts — whether the transport, centred on the header bar, clears what stands either
// side of it. When it does not, the shell lets it fall into the row rather than draw over them.
// The test reads where the bar's CENTRE is, never where the transport sits now, so the answer cannot
// flip back the moment the transport moves. See ../../docs/shell.md.

import { type RefObject, useLayoutEffect, useState } from "react";

/** The air kept between the centred cluster and either neighbour, px. */
const GAP = 12;

/** Would a box `width` wide, centred on a bar, clear `leftEnd` and `rightStart` by GAP? */
export function centredFits(
  barLeft: number,
  barWidth: number,
  width: number,
  leftEnd: number,
  rightStart: number,
): boolean {
  const left = barLeft + barWidth / 2 - width / 2;
  return leftEnd + GAP <= left && left + width + GAP <= rightStart;
}

/** Measured against `group`'s other children and the bar's actions after it, re-measured as any of them resizes. */
export function useCentredFits(
  group: RefObject<HTMLElement | null>,
  item: RefObject<HTMLElement | null>,
): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const g = group.current;
    const t = item.current;
    const bar = g?.parentElement;
    if (!g || !t || !bar) return;
    const measure = () => {
      const b = bar.getBoundingClientRect();
      let leftEnd = b.left;
      for (const c of Array.from(g.children))
        if (c !== t && !c.contains(t))
          leftEnd = Math.max(leftEnd, c.getBoundingClientRect().right);
      const after = g.nextElementSibling;
      const rightStart = after ? after.getBoundingClientRect().left : b.right;
      const w = t.getBoundingClientRect().width;
      setFits(centredFits(b.left, b.width, w, leftEnd, rightStart));
    };
    const ro = new ResizeObserver(measure);
    // A name or a badge appearing changes the left edge without resizing the bar, so each child is watched.
    const watch = () => {
      ro.disconnect();
      ro.observe(bar);
      ro.observe(t);
      for (const c of Array.from(g.children)) ro.observe(c);
      if (g.nextElementSibling) ro.observe(g.nextElementSibling);
    };
    const mo = new MutationObserver(() => {
      watch();
      measure();
    });
    watch();
    mo.observe(g, { childList: true });
    measure();
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [group, item]);
  return fits;
}
