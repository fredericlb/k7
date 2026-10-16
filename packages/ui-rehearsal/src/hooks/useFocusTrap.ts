// useFocusTrap.ts — what a hand-made modal owes the keyboard: focus moves in when it opens, Tab
// stays inside while it is open, and focus goes back where it was when it closes.
// For the dialogs that cannot be the shared Dialog primitive — ../../docs/recordings.md.

import { type RefObject, useEffect } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

export function useFocusTrap(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const before =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // Already inside (a control that opened it in place) stays where it is.
    if (!root.contains(document.activeElement)) {
      const first = focusables(root)[0];
      if (first) first.focus();
      else {
        root.tabIndex = -1;
        root.focus();
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables(root);
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !root.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !root.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (before?.isConnected) before.focus();
    };
  }, [active, ref]);
}
