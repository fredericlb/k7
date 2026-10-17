// PageFrame.tsx — the one page frame of the home side (Projects, Tasks, Libraries, Settings, About):
// a column of the same width on every page, and a heading row with the page's own actions. A page
// of narrow rows keeps them narrow INSIDE the frame rather than re-centring, so every title starts
// at the same x. The médiathèque is a two-column tool and stays full width. See ../../docs/projects.md.

import { cn } from "@frediverse/ui/lib/utils";
import type { ReactNode } from "react";

/** The column every home-side page sits in; rehearsal's `.main-inner` is the same width (packages/ui-rehearsal/src/styles/shared.css). */
export const PAGE_COLUMN =
  "mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6";

/** The page's title, an optional line under it, and its actions on the right. */
export function PageHeader({
  title,
  summary,
  actions,
}: {
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-semibold text-2xl leading-tight">{title}</h1>
        {summary && (
          <p className="text-muted-foreground text-sm tabular-nums">
            {summary}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/** A whole page: the scroll, the column, the header, then the body — `narrow` for rows of settings. */
export function PageFrame({
  title,
  summary,
  actions,
  narrow = false,
  children,
}: {
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={PAGE_COLUMN}>
        <PageHeader title={title} summary={summary} actions={actions} />
        <div
          className={cn("flex min-w-0 flex-col gap-4", narrow && "max-w-2xl")}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
