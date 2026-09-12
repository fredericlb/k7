// SharePanel.tsx — render the project through the engine (MP3/WAV download, or publish to k7
// with per-track stems), publish a frozen link, and run commit/pull on the WHOLE workspace repo.
// A PANEL anchored at the right, docked beside the panes, a dropdown being the wrong shape for a
// surface that reports — a pull says how far behind you were, an export takes a minute and says
// where the file went. See ../docs/shell.md.
//
// Every entry is a COMMAND LINE the shell dispatches, not a call of its own: two of them are
// CLI verbs (`project commit`, `project pull`) and three are the shell's (`project export`,
// `project share k7`, `project share link`). That is what keeps this and the palette saying the
// same thing.

import { Button } from "@frediverse/ui/button";
import { askText } from "@studio/project-shell/ask";
import {
  Download,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Link2,
  Loader2,
  Radio,
  Share2,
  X,
} from "lucide-react";
import { DEFAULT_VIDEO_FORMAT } from "../exportArgs";
import { m } from "../paraglide/messages.js";
import type { GitStatus } from "../types";
import { SurfaceQr } from "./SurfaceQr";

/** One surface's address, ready to hand over — computed by `App`, which holds both the launch parameters and the surface list. */
export type SurfaceLink = { id: string; type: string; url: string };

/** The badge the header's button wears — exported so the button and the panel cannot disagree about what the repo is doing. */
export function shareBadge(gitStatus: GitStatus | null): {
  behind: number;
  conflicted: boolean;
  badge: string | null;
} {
  const behind = gitStatus?.tracked ? gitStatus.behind : 0;
  const conflicted = !!gitStatus?.conflicted;
  return {
    behind,
    conflicted,
    badge: conflicted ? "!" : behind > 0 ? String(behind) : null,
  };
}

export function SharePanel({
  gitStatus,
  busy,
  externals,
  lanUrls,
  hasPicture,
  onRun,
  onClose,
}: {
  gitStatus: GitStatus | null;
  /** A render is already running — the rows grey out rather than starting a second. */
  busy: boolean;
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
  const { behind, conflicted } = shareBadge(gitStatus);

  const row =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50";
  const head = "px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground";

  // `project commit` takes the message as the rest of its line, so this asks first — an empty answer is a cancelled commit.
  const commit = () => {
    void askText({
      title: m["commit.title"](),
      body: m["commit.body"](),
      placeholder: m["commit.placeholder"](),
      confirmLabel: m["commit.confirm"](),
      // The message is the REST of the verb's line, so it stays one line — see packages/commands/docs/verbs.md.
      validate: (v) =>
        !v.trim()
          ? m["commit.needsMessage"]()
          : /[\n\r]/.test(v)
            ? m["commit.oneLine"]()
            : "",
    }).then((message) => {
      if (message?.trim()) onRun(`project commit ${message.trim()}`);
    });
  };

  return (
    <aside className="flex w-[24rem] min-w-0 shrink-0 flex-col border-l border-border bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Share2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          Partager / exporter
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
        <div className={head}>Version control</div>
        <button type="button" className={row} disabled={busy} onClick={commit}>
          <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" />
          Commit &amp; push…
        </button>
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project pull")}
        >
          <GitPullRequestArrow className="h-4 w-4 text-muted-foreground" />
          Pull
          {conflicted ? (
            <span className="ml-auto text-xs text-amber-500">diverged</span>
          ) : behind > 0 ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {behind} behind
            </span>
          ) : null}
        </button>
        {/* Said in the panel and not only in a tooltip: a branch that cannot fast-forward needs a merge by hand, which is a sentence. */}
        {conflicted ? (
          <p className="px-2 py-1 text-xs text-amber-500">
            {m["share.diverged"]()}
          </p>
        ) : null}

        <div className="my-1 border-t border-border" />
        <div className={head}>Mixdown</div>
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project export audio mp3")}
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          Export MP3
        </button>
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project export audio wav")}
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          Export WAV
        </button>

        {/* …and the PICTURE, on a project that draws one. The sound is married in: a video of a
            song is a video of its sound, so the silent one is `… video <container> none`. */}
        {hasPicture ? (
          <button
            type="button"
            className={row}
            disabled={busy}
            onClick={() =>
              onRun(`project export video ${DEFAULT_VIDEO_FORMAT}`)
            }
          >
            <Download className="h-4 w-4 text-muted-foreground" />
            Export {DEFAULT_VIDEO_FORMAT.toUpperCase()}
          </button>
        ) : null}

        <div className="my-1 border-t border-border" />
        {/* The two that PUBLISH different things: k7 gets a release, a link gets a frozen copy (packages/commands/docs/shareBundle.md). */}
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
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project share k7")}
        >
          <Radio className="h-4 w-4 text-muted-foreground" />
          Share to k7
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
