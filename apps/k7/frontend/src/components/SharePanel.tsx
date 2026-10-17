// SharePanel.tsx — render the project through the engine (MP3/WAV download, or publish to k7
// with per-track stems), and share a link to it at a checkpoint. A PANEL anchored at the right, docked beside
// the panes, a dropdown being the wrong shape for a surface that reports — an export takes a
// minute and says where the file went. See ../docs/shell.md.
// Every entry is a COMMAND LINE the shell dispatches (`project export`, `project share k7`,
// `project share link`), not a call of its own: that keeps this and the palette saying the same.

import { Button } from "@frediverse/ui/button";
import {
  Download,
  Link2,
  Loader2,
  Radio,
  Share2,
  X,
} from "@frediverse/ui/icons";
import type { ShareProgress } from "@studio/web-protocol";
import { m } from "../paraglide/messages.js";
import { ShareLinkProgress } from "./ShareLinkProgress";
import { SurfaceQr } from "./SurfaceQr";
import { VideoExportRow } from "./VideoExportRow";

/** One surface's address, ready to hand over — computed by `App`, which holds both the launch parameters and the surface list. */
export type SurfaceLink = { id: string; type: string; url: string };

export function SharePanel({
  busy,
  progress,
  externals,
  lanUrls,
  hasPicture,
  onRun,
  onClose,
}: {
  /** A render is already running — the rows grey out rather than starting a second. */
  busy: boolean;
  /** Where the link being made is — its bar sits under the row that started it. */
  progress?: ShareProgress | null;
  /** Every surface this project declares — empty is a project that declares none, and the section is then absent rather than empty. */
  externals: readonly SurfaceLink[];
  /** Where a second device reaches this app; empty leaves each code saying there is nowhere to send it. */
  lanUrls: readonly string[];
  /** Does this project draw a picture? The video row is absent when it does not — a project with
   *  no video document has nothing to render, and a greyed row would not say why. */
  hasPicture?: boolean;
  onRun: (command: string) => void;
  onClose: () => void;
}) {
  const row =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50";
  const head = "px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground";

  return (
    <aside className="flex w-[24rem] min-w-0 shrink-0 flex-col border-l border-border bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Share2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {m["share.button"]()}
        </span>
        {busy ? (
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
            aria-label={m["share.rendering2"]()}
          />
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          title={m["common.close"]()}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className={head}>{m["share.mixdown"]()}</div>
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project export audio mp3")}
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          {m["share.exportAudio"]({ format: "MP3" })}
        </button>
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project export audio wav")}
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          {m["share.exportAudio"]({ format: "WAV" })}
        </button>

        {/* …and the PICTURE, on a project that draws one. The sound is married in: a video of a
            song is a video of its sound, so the silent one is `… video <container> none`. */}
        {hasPicture ? (
          <VideoExportRow busy={busy} rowClass={row} onRun={onRun} />
        ) : null}

        <div className="my-1 border-t border-border" />
        {/* The two that PUBLISH different things: k7 gets a release, a link gets the project at a checkpoint (packages/file-service/docs/share.md). */}
        <div className={head}>{m["share.publishHead"]()}</div>
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project share link")}
        >
          <Link2 className="h-4 w-4 text-muted-foreground" />
          {m["share.shareLink"]()}
        </button>
        {progress ? <ShareLinkProgress progress={progress} /> : null}
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project share k7")}
        >
          <Radio className="h-4 w-4 text-muted-foreground" />
          {m["share.toK7"]()}
        </button>

        {/* This project's addresses, as codes to SCAN: the whole project first, so a tablet can
            edit it and not only drive a surface, then each surface it declares. */}
        {externals.length ? (
          <>
            <div className="my-1 border-t border-border" />
            <div className={head}>{m["share.otherDevice"]()}</div>
            <ul className="grid grid-cols-2 gap-2 px-2 py-1">
              {externals.map((x) => (
                <SurfaceQr
                  key={x.id}
                  id={x.id}
                  type={x.type}
                  url={x.url}
                  lanUrls={lanUrls}
                />
              ))}
            </ul>
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {m["share.sameSession"]()}
            </p>
          </>
        ) : null}
      </div>
    </aside>
  );
}
