// LibraryPage.tsx — the frame every médiathèque screen sits in: one column width, and one header with
// the title, its count, the screen's own actions and, on a detail page, the same Back.
// The one thing a reader would get wrong: a tool screen (a tree beside its contents, a song's tabs) FILLS
// the height and scrolls its own panes; a list scrolls as a page. See ../docs/library.md.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { ReactNode } from "react";
import { useLabels } from "./host";

/** The column of k7's home pages and of the rehearsal pages: 64rem, so every title starts at the same x. */
export const LIBRARY_COLUMN = "mx-auto w-full max-w-5xl px-3 sm:px-6";

/** The one way back from a detail page; the rehearsal pages draw the same (packages/ui-rehearsal/src/components/BackButton.tsx). */
export function BackButton({ onClick }: { onClick: () => void }) {
  const back = useLabels().common.back;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0"
      onClick={onClick}
      aria-label={back}
      title={back}
    >
      <ArrowLeft className="size-4" />
      <span className="hidden sm:inline">{back}</span>
    </Button>
  );
}

export interface LibraryHeaderProps {
  title: ReactNode;
  /** How many the section holds, beside its title. */
  count?: number;
  /** A line under the title — a song's path. */
  sub?: ReactNode;
  /** The screen's own acts, on the right: its primary action first. */
  actions?: ReactNode;
  /** A detail page's way back to the list it was opened from. */
  onBack?: () => void;
}

export function LibraryHeader({
  title,
  count,
  sub,
  actions,
  onBack,
}: LibraryHeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {onBack ? <BackButton onClick={onBack} /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="flex min-w-0 items-baseline gap-2 font-semibold text-2xl leading-tight">
          <span className="truncate">{title}</span>
          {count != null ? (
            <span className="shrink-0 font-normal text-base text-muted-foreground tabular-nums">
              {count}
            </span>
          ) : null}
        </h1>
        {sub ? (
          <div className="truncate font-mono text-muted-foreground text-xs">
            {sub}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/** A whole screen: the header in the column, then the body — `fill` for a tool whose panes scroll themselves. */
export function LibraryPage({
  fill = false,
  children,
  ...header
}: LibraryHeaderProps & { fill?: boolean; children: ReactNode }) {
  const top = (
    <div className={cn(LIBRARY_COLUMN, "shrink-0 pt-4 pb-3 sm:pt-6")}>
      <LibraryHeader {...header} />
    </div>
  );
  if (fill)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {top}
        <div className={cn(LIBRARY_COLUMN, "flex min-h-0 flex-1 flex-col")}>
          {children}
        </div>
      </div>
    );
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {top}
      <div className={cn(LIBRARY_COLUMN, "pb-6")}>{children}</div>
    </div>
  );
}
