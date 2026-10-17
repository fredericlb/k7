// VideoExportRow.tsx — the share panel's video export: MP4 first when this browser can encode it,
// since that is what a phone and every social site play, WebM otherwise; 720p or 1080p. It only
// builds the `project export video …` line the shell already runs. See ../../docs/shell.md.

import { Download } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { probeExportSupport } from "@studio/ui-eyes/exportSupport";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";

type Format = "mp4" | "webm";
type Size = "720p" | "1080p";

/** The frame each size is probed at: the encoder is asked about what it will actually be given. */
const PROBE: Record<Size, [number, number]> = {
  "720p": [1280, 720],
  "1080p": [1920, 1080],
};

export function VideoExportRow({
  busy,
  rowClass,
  onRun,
}: {
  busy: boolean;
  rowClass: string;
  onRun: (command: string) => void;
}) {
  const [size, setSize] = useState<Size>("1080p");
  // Null while asked; MP4 is offered only once the encoder says yes.
  const [mp4, setMp4] = useState<boolean | null>(null);
  const [format, setFormat] = useState<Format | null>(null);

  useEffect(() => {
    let live = true;
    const [w, h] = PROBE[size];
    void probeExportSupport("mp4", w, h)
      .then((s) => live && setMp4(s.ok))
      .catch(() => live && setMp4(false));
    return () => {
      live = false;
    };
  }, [size]);

  // MP4 by default where it can be made; a choice made by hand is kept.
  const fmt: Format = format ?? (mp4 ? "mp4" : "webm");
  const pill = (on: boolean) =>
    cn(
      "rounded px-1.5 py-0.5 text-xs",
      on
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className={rowClass}
        disabled={busy || mp4 === null}
        onClick={() => onRun(`project export video ${fmt} size=${size}`)}
      >
        <Download className="h-4 w-4 text-muted-foreground" />
        {m["share.exportVideo"]({ format: fmt.toUpperCase(), size })}
      </button>
      <div className="flex flex-wrap items-center gap-1 px-8 pb-1">
        {(mp4 ? (["mp4", "webm"] as const) : (["webm"] as const)).map((f) => (
          <button
            key={f}
            type="button"
            className={pill(fmt === f)}
            onClick={() => setFormat(f)}
          >
            {f.toUpperCase()}
          </button>
        ))}
        <span className="mx-1 text-border">·</span>
        {(["720p", "1080p"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={pill(size === s)}
            onClick={() => setSize(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {mp4 === false && (
        <p className="px-8 pb-1 text-muted-foreground text-xs">
          {m["share.noMp4"]()}
        </p>
      )}
    </div>
  );
}
