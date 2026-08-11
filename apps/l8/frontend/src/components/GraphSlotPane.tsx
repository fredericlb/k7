// GraphSlotPane.tsx — the frame every occupant of the graph's slot wears: the shell that fills
// the pane, the title bar, and the one ✕ that puts the graph back. The occupants supply a body
// and what to call it. See docs/shell.md on the slot itself.

import { X } from "lucide-react";

/**
 * The close button, written once.
 *
 * It was written four times, and the four had drifted: three sat in a title bar and the
 * fourth was buried in `PianoRoll`, which is not a slot occupant at all but the thing one of
 * them draws. A ✕ that lives in the leaf cannot be relied on by the frame.
 */
function CloseSlot({
  onClose,
  className,
}: {
  onClose: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      className={`rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground ${className}`}
      title="Close — back to the graph"
      aria-label="Close — back to the graph"
      onClick={onClose}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * One frame for everything that takes the graph's place.
 *
 * The SHELL is the point. There were four, all different — `relative flex h-full min-h-0
 * flex-1`, `flex min-h-0 min-w-0 flex-1 flex-col`, the same plus a background, and a fourth
 * with `w-full` — and two of the four needed a compensating `<div>` around them at the mount
 * site because their root did not fill the pane on its own. That is drift patched at the call
 * site rather than fixed, and every new occupant paid it again.
 *
 * Three ways to wear it, because the occupants genuinely differ:
 *
 * - `title` (+ optional `note`) — the plain case. A name, a detail, the ✕.
 * - `bar` — a strip of your own, for an occupant whose header carries CONTROLS rather than a
 *   label: the recording pane counts beats and offers Stop. The ✕ is still the frame's, added
 *   last with `ml-auto`, which reproduces both of that pane's layouts (with Stop present it
 *   absorbs the space first and the ✕ follows it; without, the ✕ takes it).
 * - neither — no bar at all, and the ✕ floats over the top-right corner. A clip's contents draw
 *   their own header already, and a second row above it would say the same thing twice.
 */
export function GraphSlotPane({
  title,
  note,
  bar,
  onClose,
  children,
}: {
  title?: React.ReactNode;
  note?: React.ReactNode;
  /** Replaces title/note entirely — the ✕ is still the frame's. */
  bar?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const hasBar = bar !== undefined || title !== undefined;
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      {hasBar && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          {bar ?? (
            <>
              <span className="font-medium text-foreground">{title}</span>
              {note != null && <span>· {note}</span>}
            </>
          )}
          <CloseSlot onClose={onClose} className="ml-auto" />
        </div>
      )}
      {/* `relative` for the floating ✕ of the bar-less case, and harmless otherwise. */}
      <div className="relative min-h-0 min-w-0 flex-1">
        {children}
        {!hasBar && (
          <CloseSlot
            onClose={onClose}
            className="absolute right-2 top-2 z-10 bg-background/80"
          />
        )}
      </div>
    </div>
  );
}
