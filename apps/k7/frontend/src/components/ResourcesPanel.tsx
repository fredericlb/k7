// ResourcesPanel.tsx — the project's EXTERNAL RESOURCES, as a panel on the right: every audio and
// video clip the user imported, to preview here and drag onto a lane again. It plays in the
// BROWSER, beside the engine, so a preview stops when asked (../docs/resources.md).

import { Button } from "@frediverse/ui/button";
import {
  Film,
  FolderOpen,
  Loader2,
  Music,
  Play,
  Square,
  TriangleAlert,
  X,
} from "@frediverse/ui/icons";
import { formatBytes } from "@studio/ui-chains-react/node-load";
import type { ProjectResource } from "@studio/web-protocol/resources";
import { useCallback, useEffect, useState } from "react";
import { api, mediaUrl } from "../api";
import { resourceMime } from "../fileDrop";
import { m } from "../paraglide/messages.js";

/** What a lane is handed when a resource is dropped on it: the clip, and where to fetch it for a probe. */
export interface DraggedResource {
  id: string;
  url: string;
}

export function ResourcesPanel({
  reloadKey,
  onClose,
}: {
  /** Bumped by every write: a file dropped on the timeline joins the list without a refresh. */
  reloadKey: number;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ProjectResource[] | null>(null);
  const [error, setError] = useState("");
  /** The one resource whose player is open, by id — opening another closes it, and unmounting it stops it. */
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows((await api.resources()).resources);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadKey` IS the signal — the project changed on disk.
  useEffect(() => {
    void refresh();
  }, [refresh, reloadKey]);

  return (
    <aside className="flex w-[24rem] min-w-0 shrink-0 flex-col border-border border-l bg-background">
      <header className="flex shrink-0 items-center gap-1 border-border border-b px-2 py-1.5">
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate px-1.5 text-sm">
          {m["res.title"]()}
        </span>
        <Button
          size="icon"
          variant="ghost"
          title={m["common.close"]()}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {error ? (
        <p className="shrink-0 border-b px-2 py-1.5 text-destructive text-xs">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null ? (
          <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> {m["common.loading"]()}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-3 text-muted-foreground text-sm">
            {m["res.empty"]()}
          </p>
        ) : (
          <>
            <p className="px-3 pt-2 pb-1 text-muted-foreground text-xs">
              {m["res.hint"]()}
            </p>
            <ul>
              {rows.map((r) => (
                <ResourceRow
                  key={r.id}
                  r={r}
                  open={open === r.id}
                  onOpen={(on) => setOpen(on ? r.id : null)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}

/** One resource: drag it onto a lane, or open its player under it. */
function ResourceRow({
  r,
  open,
  onOpen,
}: {
  r: ProjectResource;
  open: boolean;
  onOpen: (on: boolean) => void;
}) {
  const Icon = r.kind === "video" ? Film : Music;
  // A browser plays a video's light copy when there is one: the master may be a codec it cannot decode.
  const url = mediaUrl(r.preview ?? r.source);
  return (
    <li className="px-1">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a DRAG source, which a keyboard has no gesture for; the button inside is the control. */}
      <div
        className="flex cursor-grab items-center gap-1 rounded hover:bg-accent active:cursor-grabbing"
        draggable={!r.missing}
        title={r.source}
        onDragStart={(e) => {
          const payload: DraggedResource = { id: r.id, url };
          e.dataTransfer.setData(resourceMime(r.kind), JSON.stringify(payload));
          e.dataTransfer.effectAllowed = "copy";
        }}
      >
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          disabled={r.missing}
          title={open ? m["res.stop"]() : m["res.preview"]()}
          aria-label={open ? m["res.stop"]() : m["res.preview"]()}
          aria-pressed={open}
          onClick={() => onOpen(!open)}
        >
          {open ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </Button>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate py-1 text-sm">{r.id}</span>
        {r.missing ? (
          <span
            className="flex shrink-0 items-center gap-1 text-destructive text-xs"
            title={m["res.missing"]()}
          >
            <TriangleAlert className="h-3 w-3" /> {m["res.missingShort"]()}
          </span>
        ) : (
          <span className="shrink-0 pr-1 font-mono text-[10px] text-muted-foreground tabular-nums">
            {formatBytes(r.bytes)}
          </span>
        )}
      </div>
      {/* The player exists only while open: unmounting it is what stops the sound. */}
      {open && !r.missing ? (
        r.kind === "video" ? (
          // biome-ignore lint/a11y/useMediaCaption: a preview of the user's own footage, which carries no captions track.
          <video
            src={url}
            controls
            autoPlay
            className="my-1 w-full rounded bg-black"
            onEnded={() => onOpen(false)}
          />
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: a preview of the user's own audio, which carries no captions track.
          <audio
            src={url}
            controls
            autoPlay
            className="my-1 h-8 w-full"
            onEnded={() => onOpen(false)}
          />
        )
      ) : null}
    </li>
  );
}
