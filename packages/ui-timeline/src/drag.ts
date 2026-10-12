// drag.ts — following ONE pointer from its press to its end, the way every drag here should: the
// other fingers are ignored, a release commits, and anything else — the browser cancelling the
// gesture, the window losing focus, the component going away — abandons it. A drag that listened
// for `pointerup` alone stayed armed after a cancel, and the next click anywhere committed it.
// See docs/drag.md.

import { useCallback, useEffect, useRef } from "react";

export interface DragHandlers {
  /** The pointer moved — only the one that pressed. */
  move?: (ev: PointerEvent) => void;
  /** It was released: the gesture is done, and this is where it commits. */
  end?: (ev: PointerEvent) => void;
  /** It was taken away — cancelled, focus lost, or disposed: undo whatever the gesture showed, write nothing. */
  cancel?: () => void;
}

/** Follow the pointer that made `press`; the returned function abandons the gesture if it is still running. */
export function followPointer(
  press: { pointerId: number },
  h: DragHandlers,
): () => void {
  const id = press.pointerId;
  let over = false;
  const finish = () => {
    over = true;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("blur", onBlur);
  };
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId === id) h.move?.(ev);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    finish();
    h.end?.(ev);
  };
  const abandon = () => {
    if (over) return;
    finish();
    h.cancel?.();
  };
  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId === id) abandon();
  };
  const onBlur = () => abandon();
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("blur", onBlur);
  return abandon;
}

/** `followPointer`, abandoned for you when the component unmounts mid-drag. */
export function usePointerFollow(): (
  press: { pointerId: number },
  h: DragHandlers,
) => () => void {
  const live = useRef(new Set<() => void>());
  useEffect(() => {
    const all = live.current;
    return () => {
      for (const abandon of [...all]) abandon();
    };
  }, []);
  return useCallback((press, h) => {
    let abandon = (): void => {};
    const forget = () => live.current.delete(abandon);
    abandon = followPointer(press, {
      move: h.move,
      end: (ev) => {
        forget();
        h.end?.(ev);
      },
      cancel: () => {
        forget();
        h.cancel?.();
      },
    });
    live.current.add(abandon);
    return abandon;
  }, []);
}
