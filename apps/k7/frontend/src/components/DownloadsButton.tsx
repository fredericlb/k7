// DownloadsButton.tsx — the sidebar's download manager: an icon with "done/total" on it while anything comes
// down (library songs, the engine's models and instruments), and the list in a popover.
// Nothing at all while the list is empty. The list is @studio/http-client's (packages/http-client/docs/downloads.md);
// the backend's song update checks are mirrored in by SongSyncDownloads.tsx.

import { Button } from "@frediverse/ui/button";
import {
  AudioLines,
  Check,
  CircleAlert,
  Clock,
  Disc3,
  Download as DownloadIcon,
  Loader2,
  type LucideIcon,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@frediverse/ui/popover";
import {
  clearFinished,
  type Download,
  type DownloadKind,
  downloadsSnapshot,
  subscribeDownloads,
  syncDownloads,
} from "@studio/http-client/downloads";
import { useEffect, useSyncExternalStore } from "react";
import { m } from "../paraglide/messages.js";
import { useDesktopEngine } from "../settings/desktopEngine";
import { SongSyncDownloads } from "./SongSyncDownloads";

const KIND_ICON: Record<DownloadKind, LucideIcon> = {
  song: Disc3,
  engine: AudioLines,
};

const MB = 1e6;

/** The supervisor's instrument downloads, mirrored into the list; the hook opens nothing off the tray. */
function InstrumentDownloads() {
  const engine = useDesktopEngine();
  const snapshot = engine?.snapshot;
  useEffect(() => {
    if (!snapshot) return;
    const labelOf = (name: string) =>
      snapshot.instruments?.find((i) => i.name === name)?.label ?? name;
    syncDownloads(
      "instrument:",
      (snapshot.downloads ?? []).map(
        (d): Download => ({
          key: `instrument:${d.name}`,
          kind: "engine",
          label: labelOf(d.name),
          phase:
            d.phase === "failed"
              ? "failed"
              : d.phase === "queued"
                ? "queued"
                : "running",
          received: d.received,
          total: d.total || undefined,
          error: d.error,
        }),
      ),
    );
  }, [snapshot]);
  return null;
}

function Row({ d }: { d: Download }) {
  const Kind = KIND_ICON[d.kind];
  const pct =
    d.phase === "running" && d.total
      ? Math.min(100, Math.floor(((d.received ?? 0) / d.total) * 100))
      : null;
  const said =
    d.phase === "failed"
      ? (d.error ?? m["downloads.failed"]())
      : d.phase === "queued"
        ? m["downloads.queued"]()
        : d.phase === "done"
          ? m["downloads.done"]()
          : d.received
            ? d.total
              ? `${pct} % · ${(d.received / MB).toFixed(0)} / ${(d.total / MB).toFixed(0)} MB`
              : `${(d.received / MB).toFixed(0)} MB`
            : m["downloads.running"]();
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1.5">
      <Kind className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm" title={d.label}>
          {d.label}
        </span>
        <span
          className={cn(
            "block truncate text-[11px]",
            d.phase === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
          title={said}
        >
          {said}
        </span>
        {pct !== null && (
          <span className="mt-1 block h-1 overflow-hidden rounded bg-muted">
            <span
              className="block h-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </span>
        )}
      </span>
      {d.phase === "running" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : d.phase === "queued" ? (
        <Clock className="size-3.5 shrink-0 text-muted-foreground" />
      ) : d.phase === "done" ? (
        <Check className="size-3.5 shrink-0 text-emerald-500" />
      ) : (
        <CircleAlert className="size-3.5 shrink-0 text-destructive" />
      )}
    </li>
  );
}

/** The manager's button and popover, and the supervisor's instruments fed into the list. */
export function DownloadsButton() {
  const all = useSyncExternalStore(subscribeDownloads, downloadsSnapshot);
  const done = all.filter((d) => d.phase === "done").length;
  const failed = all.some((d) => d.phase === "failed");
  const left = all.filter(
    (d) => d.phase === "queued" || d.phase === "running",
  ).length;
  const label = m["downloads.title"]({ done, total: all.length });
  return (
    <>
      <InstrumentDownloads />
      <SongSyncDownloads />
      {all.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="relative shrink-0"
              aria-label={label}
              title={label}
            >
              {left > 0 ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
              <span
                className={cn(
                  "absolute -right-1 -top-1 rounded-full px-1 text-[10px] font-semibold leading-4 tabular-nums",
                  failed
                    ? "bg-destructive text-white"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {done}/{all.length}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            className="w-[min(22rem,calc(100vw-1.5rem))] p-1"
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="font-medium text-sm">
                {m["downloads.heading"]()}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {m["downloads.left"]({ left })}
              </span>
            </div>
            <ul className="max-h-80 overflow-auto">
              {all.map((d) => (
                <Row key={d.key} d={d} />
              ))}
            </ul>
            {all.some((d) => d.phase === "done" || d.phase === "failed") && (
              <div className="flex justify-end px-1 pt-1">
                <Button variant="ghost" size="sm" onClick={clearFinished}>
                  {m["downloads.clear"]()}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
