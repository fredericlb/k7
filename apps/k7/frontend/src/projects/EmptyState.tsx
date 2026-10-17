// EmptyState.tsx — what a page shows when it has nothing to list: a glyph, one sentence saying what
// would be here, and the act that puts the first one there, as a button on the spot. It never
// describes where a control is elsewhere on the screen. The médiathèque and the rehearsal pages
// draw the same block in their own packages, which cannot import this one. See ../../docs/projects.md.

import type { LucideIcon } from "@frediverse/ui/icons";
import type { ReactNode } from "react";

/** The block's classes, the one place they are spelled for k7's own pages. */
export const EMPTY_STATE =
  "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center";

export function EmptyState({
  icon: Icon,
  children,
  actions,
}: {
  icon: LucideIcon;
  /** One sentence: what would be listed here, in the reader's words. */
  children: ReactNode;
  /** The act that makes the first one — absent only where nothing can be done from here. */
  actions?: ReactNode;
}) {
  return (
    <div className={EMPTY_STATE}>
      <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-md text-muted-foreground text-sm">{children}</p>
      {actions && (
        <div className="flex flex-wrap justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}
