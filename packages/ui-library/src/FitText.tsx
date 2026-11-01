// FitText.tsx — one line of text that shrinks to the width it is given on a narrow screen, down to a floor past which
// it truncates; on a wider one it truncates as any title does. What reads wrong: the size is MEASURED, at the class's
// own size each time, so a longer or shorter text never inherits the last one's scale. See ../docs/songPlayer.md.

import { useLayoutEffect, useRef } from "react";

/** The `sm` breakpoint: below it, the text fits rather than truncates. */
const NARROW = "(max-width: 639.98px)";
/** The smallest it shrinks to, in px: under that a title is no longer read at a glance. */
const FLOOR_PX = 14;

export function FitText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof matchMedia !== "function") return;
    const narrow = matchMedia(NARROW);
    const fit = () => {
      // Measured at the class's own size: the scale is of THIS text, never compounded on the last one's.
      el.style.fontSize = "";
      if (!narrow.matches) return;
      const need = el.scrollWidth;
      const have = el.clientWidth;
      if (!have || need <= have) return;
      const base = Number.parseFloat(getComputedStyle(el).fontSize);
      const px = Math.max(FLOOR_PX, Math.floor((base * have * 10) / need) / 10);
      // Written on the element, not through state: React would not re-apply a size it thinks unchanged.
      el.style.fontSize = `${px}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    narrow.addEventListener("change", fit);
    return () => {
      ro.disconnect();
      narrow.removeEventListener("change", fit);
    };
  }, [text]);

  return (
    <span ref={ref} className="block truncate">
      {text}
    </span>
  );
}
