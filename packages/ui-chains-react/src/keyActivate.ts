// keyActivate.ts — Enter on a focused card or corner button does what its click does.
// The one thing a reader would get wrong: Space is NOT handled — a host's Space is its transport,
// wherever focus is (apps/k7/frontend/docs/shell.md), and a card that ate it would stop the music.

import type { KeyboardEvent } from "react";

/** An onKeyDown that runs `fn` on Enter aimed at the element itself, not at a control inside it. */
export const onEnter =
  (fn: (e: KeyboardEvent) => void) =>
  (e: KeyboardEvent): void => {
    if (e.key !== "Enter" || e.target !== e.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
    fn(e);
  };
