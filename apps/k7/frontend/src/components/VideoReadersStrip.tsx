// VideoReadersStrip.tsx — the per-placement dock for an open video_tracks/*.k7x: one
// small <video> reader per `events:` entry, with Set From / Set To writing the reader's
// current timecode into that placement's `source_from` / `length`. Both are surgical text
// rewrites of the open file (@studio/song/yaml/videoTrackFile); autosave writes it.

import { Button } from "@frediverse/ui/button";
import { X } from "@frediverse/ui/icons";
import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "../api";
import { m } from "../paraglide/messages.js";

export interface VideoReader {
  ref: string;
  src: string; // workspace-relative media path
  sourceFrom: number; // seconds
  length: number; // seconds (0 == to the end of the source)
}

function fmtTc(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, "0")}`;
}

function ReaderCard({
  reader,
  onSetFrom,
  onSetTo,
}: {
  reader: VideoReader;
  onSetFrom: (ref: string, t: number) => void;
  onSetTo: (ref: string, t: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);

  // Park the playhead at the placement's source_from, so opening a reader shows the in-point, not the file start.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (Number.isFinite(reader.sourceFrom) && reader.sourceFrom > 0) {
      try {
        v.currentTime = reader.sourceFrom;
      } catch {
        /* not loaded yet — seeked on loadedmetadata below */
      }
    }
  }, [reader.sourceFrom]);

  return (
    <div className="flex w-64 shrink-0 flex-col gap-1 rounded-md border border-border bg-card/60 p-2">
      <div className="flex items-center justify-between text-xs">
        <span className="truncate font-mono font-semibold" title={reader.ref}>
          {reader.ref}
        </span>
        <span className="font-mono text-muted-foreground">{fmtTc(t)}</span>
      </div>
      <video
        ref={ref}
        src={mediaUrl(reader.src)}
        className="h-24 w-full rounded bg-black object-contain"
        controls
        preload="metadata"
        onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(v.duration || 0);
          if (Number.isFinite(reader.sourceFrom) && reader.sourceFrom > 0) {
            try {
              v.currentTime = reader.sourceFrom;
            } catch {
              /* seek after metadata should succeed; ignore if not */
            }
          }
        }}
      />
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="font-mono">
          from {fmtTc(reader.sourceFrom)}
          {reader.length > 0
            ? ` · to ${fmtTc(reader.sourceFrom + reader.length)}`
            : ""}
          {duration > 0 ? ` · src ${fmtTc(duration)}` : ""}
        </span>
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 flex-1"
          onClick={() => onSetFrom(reader.ref, ref.current?.currentTime ?? 0)}
          title={m["video.setFromHint"]()}
        >
          {m["video.setFrom"]()}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 flex-1"
          onClick={() => onSetTo(reader.ref, ref.current?.currentTime ?? 0)}
          title={m["video.setToHint"]()}
        >
          {m["video.setTo"]()}
        </Button>
      </div>
    </div>
  );
}

export function VideoReadersStrip({
  readers,
  onSetFrom,
  onSetTo,
  onClose,
}: {
  readers: VideoReader[];
  onSetFrom: (ref: string, t: number) => void;
  onSetTo: (ref: string, t: number) => void;
  onClose: () => void;
}) {
  if (!readers.length) return null;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1 text-xs text-muted-foreground">
        <span>{m["video.readersHeader"]()}</span>
        <button
          type="button"
          className="rounded px-1 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          title={m["video.hideReaders"]()}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
        {readers.map((r) => (
          <ReaderCard
            key={r.ref}
            reader={r}
            onSetFrom={onSetFrom}
            onSetTo={onSetTo}
          />
        ))}
      </div>
    </div>
  );
}
