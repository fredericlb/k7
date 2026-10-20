// useWindowKey.ts — a keydown listener on the window while `enabled`, always calling this render's
// handler, and `isTyping`: whether the key went to a text field, which owns every key it gets.

import { useEffect } from "react";
import { useLatest } from "./useLatest";

/** The key landed in an input, a textarea or an editable element. */
export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable === true)
  );
}

export function useWindowKey(
  onKey: (e: KeyboardEvent) => void,
  {
    enabled = true,
    capture = false,
  }: { enabled?: boolean; capture?: boolean } = {},
): void {
  const latest = useLatest(onKey);
  useEffect(() => {
    if (!enabled) return;
    const listener = (e: KeyboardEvent) => latest.current(e);
    window.addEventListener("keydown", listener, capture);
    return () => window.removeEventListener("keydown", listener, capture);
  }, [enabled, capture, latest]);
}
