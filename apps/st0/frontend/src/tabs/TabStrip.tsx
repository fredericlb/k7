// TabStrip.tsx — the tabs in the title bar, drawn by st0 because the settings screen already
// set that precedent: desktop chrome is a page on the app's own origin, not a second build.
// It is loaded in a view of its own and outlives every project below it — apps/st0-standalone/docs/tabs.md.

import { House, Music, X } from "@frediverse/ui/icons";
import { isProjectAddress } from "@studio/web-protocol/projects";
import { type CSSProperties, useEffect, useState } from "react";
import { AccountButton } from "./AccountButton";
import { type TabRow, tabsBridge } from "./bridge";

// `-webkit-app-region` is Electron's, and React's CSSProperties has never carried it.
const DRAG = { WebkitAppRegion: "drag" } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

/** Room the window's own controls take on the strip: macOS's traffic lights on the left, the caption buttons on the right. */
function inset(side: "inset" | "right"): number | undefined {
  return (
    Number(new URLSearchParams(window.location.search).get(side)) || undefined
  );
}

/** A tab's label: what the page calls itself, else the last segment of its address. */
function label(row: TabRow): string {
  if (row.title && row.title !== "st0") return row.title;
  try {
    const path = new URL(row.url).pathname.replace(/\/+$/, "");
    return path.split("/").pop() || "studio";
  } catch {
    return "studio";
  }
}

export function TabStrip() {
  const [rows, setRows] = useState<TabRow[]>(() => tabsBridge()?.list() ?? []);
  useEffect(() => {
    const bridge = tabsBridge();
    if (!bridge) return;
    setRows(bridge.list());
    return bridge.subscribe(setRows);
  }, []);

  const bridge = tabsBridge();
  return (
    // The whole bar drags the window; every control below takes itself back out.
    <div
      className="flex h-screen items-stretch gap-1 overflow-hidden bg-background px-1 text-foreground"
      style={{
        ...DRAG,
        paddingLeft: inset("inset"),
        paddingRight: inset("right"),
      }}
    >
      {rows.map((row) => (
        <div
          key={row.id}
          className={`group flex items-center gap-1 self-center rounded-md px-2 py-1 text-xs ${
            // The home tab is an icon and stays that width; the rest share what is left.
            row.home ? "shrink-0" : "min-w-0 max-w-52 flex-1"
          } ${
            row.active
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary/50"
          }`}
          style={NO_DRAG}
        >
          <button
            type="button"
            className={
              row.home
                ? "flex items-center"
                : "min-w-0 flex-1 truncate text-left"
            }
            onClick={() => bridge?.select(row.id)}
            title={row.home ? "Projects" : row.url}
            aria-label={row.home ? "Projects" : undefined}
          >
            {row.home ? (
              <House className="h-3.5 w-3.5" />
            ) : (
              <span className="flex min-w-0 items-center gap-1.5">
                {/* A note marks the tabs that hold a SONG, so settings and the rest read as chrome. */}
                {isProjectAddress(row.url) && (
                  <Music className="h-3 w-3 shrink-0" />
                )}
                <span className="min-w-0 truncate">{label(row)}</span>
              </span>
            )}
          </button>
          {/* No close on home: it is where every other tab is opened from. */}
          {!row.home && (
            <button
              type="button"
              aria-label="Close tab"
              className="shrink-0 rounded p-0.5 opacity-0 hover:bg-secondary group-hover:opacity-100"
              onClick={() => bridge?.close(row.id)}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {/* Pushed to the right end, just short of the window's own buttons. */}
      <div className="ml-auto flex shrink-0 items-center" style={NO_DRAG}>
        <AccountButton rows={rows} />
      </div>
    </div>
  );
}
