// GraphSlotPane.tsx — the frame every occupant of the graph's slot wears: the shell that fills
// the pane, the title bar, and the one ✕ that puts the graph back. The occupants supply a body
// and what to call it. See docs/shell.md on the slot itself.

import { X } from "lucide-react";

/** The close button, written once — it was written four times and the four had drifted; a ✕ living in the leaf cannot be relied on by the frame. */
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

/** One frame for everything that takes the graph's place — the SHELL is the point, worn three ways: `title`, `bar`, or no bar at all. */
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
