// PublicationsList.tsx — releases grouped by the pages that list them, then the ones on no page.
// A page is a collapsible group, closed by default; a release on two pages shows under both.
// Why one list and not a Releases tab and a Pages tab: ../../../docs/pages.md.

import { Button } from "@frediverse/ui/button";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Plus,
} from "@frediverse/ui/icons";
import { useState } from "react";
import type { Page, Release } from "../types";

interface Props {
  releases: Release[];
  pages: Page[];
  onOpenRelease: (r: Release) => void;
  onNewRelease: () => void;
  onOpenPage: (p: Page) => void;
  onNewPage: () => void;
}

/** Each page with its releases in the page's order, and the releases no page lists. */
export function groupReleases(pages: Page[], releases: Release[]) {
  const byId = new Map(releases.map((r) => [r.id, r]));
  const groups = pages.map((page) => ({
    page,
    releases: page.releaseIds.flatMap((id) => byId.get(id) ?? []),
  }));
  const linked = new Set(pages.flatMap((p) => p.releaseIds));
  const unlinked = releases.filter((r) => !linked.has(r.id));
  return { groups, unlinked };
}

export function PublicationsList({
  releases,
  pages,
  onOpenRelease,
  onNewRelease,
  onOpenPage,
  onNewPage,
}: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const { groups, unlinked } = groupReleases(pages, releases);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const releaseRow = (r: Release) => (
    <li key={r.id} className="session-item" onClick={() => onOpenRelease(r)}>
      <div className="session-name">{r.title}</div>
      <div className="session-meta">
        <span>{r.artist}</span>
        {r.canDownload && <Download className="size-3" />}
      </div>
    </li>
  );

  return (
    <div className="moments-pane">
      <div className="row">
        <Button variant="outline" onClick={onNewRelease}>
          <Plus className="size-4" /> New release
        </Button>
        <Button variant="outline" onClick={onNewPage}>
          <Plus className="size-4" /> New page
        </Button>
      </div>

      {releases.length === 0 && pages.length === 0 && (
        <p className="muted small">No releases or pages yet.</p>
      )}

      {groups.map(({ page, releases: own }) => {
        const isOpen = open.has(page.id);
        return (
          <section key={page.id} className="pub-group">
            <div className="pub-group-head">
              {/* The whole header toggles; opening the page itself is the button at its end. */}
              <div
                className="pub-group-toggle"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => toggle(page.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(page.id);
                  }
                }}
              >
                {isOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                <span className="session-name">@{page.nametag}</span>
                <span className="muted small">
                  {own.length} release{own.length === 1 ? "" : "s"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenPage(page)}
                title={`Open the page @${page.nametag}`}
              >
                <ExternalLink className="size-4" /> Open
              </Button>
            </div>
            {isOpen && (
              <ul className="session-list home-list pub-group-list">
                {own.length === 0 && (
                  <li className="home-list-empty muted small">
                    No releases on this page yet.
                  </li>
                )}
                {own.map(releaseRow)}
              </ul>
            )}
          </section>
        );
      })}

      {unlinked.length > 0 && (
        <section className="pub-group">
          <h3 className="pub-unlinked-title">
            Not on a page{" "}
            <span className="muted small">({unlinked.length})</span>
          </h3>
          <ul className="session-list home-list">{unlinked.map(releaseRow)}</ul>
        </section>
      )}
    </div>
  );
}
