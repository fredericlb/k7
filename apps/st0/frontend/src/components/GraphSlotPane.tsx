// GraphSlotPane.tsx — the frame every occupant of the graph's slot wears: the shell that fills
// the pane and the title bar. It has no ✕: a bottom panel closes from the footer's panel buttons
// or Escape. The occupants supply a body and what to call it. See docs/shell.md on the slot itself.

/** One frame for everything that takes the graph's place — the SHELL is the point, worn three ways: `title`, `bar`, or no bar at all. */
export function GraphSlotPane({
  title,
  note,
  bar,
  aside,
  children,
}: {
  title?: React.ReactNode;
  note?: React.ReactNode;
  /** Replaces title/note entirely. */
  bar?: React.ReactNode;
  /** A column pinned at the body's right, sized by itself. */
  aside?: React.ReactNode;
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
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
        {aside}
      </div>
    </div>
  );
}
