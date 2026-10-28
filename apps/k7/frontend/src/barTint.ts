// barTint.ts — the command bar's strip: one opaque fill, idle or waiting, and a breathing ring for the wait.
// What reads wrong: the wait must never thin the fill, since the page then shows through the line being typed.

/** The strip's classes: `bg-popover` always, plus the accent's inset ring while a command waits on its answers. */
export const barTint = (pending: boolean): string =>
  `bg-popover ${
    pending
      ? "motion-safe:animate-pending motion-reduce:ring-2 motion-reduce:ring-inset motion-reduce:ring-primary"
      : ""
  }`;
