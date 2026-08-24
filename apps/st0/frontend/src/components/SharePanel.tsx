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
import {
  ClipboardCopy,
  Download,
  ExternalLink,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Link2,
  Loader2,
  Radio,
  Share2,
  X,
} from "lucide-react";
import type { GitStatus } from "../types";

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
  onRun,
  onClose,
}: {
  gitStatus: GitStatus | null;
  /** A render is already running — the rows grey out rather than starting a second. */
  busy: boolean;
  /** Every surface this project declares — empty is a project that declares none, and the section is then absent rather than empty. */
  externals: readonly SurfaceLink[];
  onRun: (command: string) => void;
  onClose: () => void;
}) {
  const { behind, conflicted } = shareBadge(gitStatus);

  const row =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50";
  const head = "px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground";

  // `project commit` takes the message as the rest of its line, so this asks first — an empty prompt is a cancelled commit.
  const commit = () => {
    const message = window
      .prompt("Commit message (stages + pushes the whole repo):", "")
      ?.trim();
    if (message) onRun(`project commit ${message}`);
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
            aria-label="rendu en cours"
          />
        ) : null}
        <Button size="icon" variant="ghost" title="Fermer" onClick={onClose}>
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
            le dépôt a divergé — un pull demande une fusion à la main
          </p>
        ) : null}

        <div className="my-1 border-t border-border" />
        <div className={head}>Mixdown</div>
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project export mp3")}
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          Export MP3
        </button>
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project export wav")}
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          Export WAV
        </button>

        <div className="my-1 border-t border-border" />
        {/* The two that PUBLISH different things: k7 gets a release, a link gets a frozen copy (packages/commands/docs/shareBundle.md). */}
        <div className={head}>Publier</div>
        <button
          type="button"
          className={row}
          disabled={busy}
          onClick={() => onRun("project share link")}
        >
          <Link2 className="h-4 w-4 text-muted-foreground" />
          Partager un lien
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

        {/* The addresses of this project's surfaces, apart from the shares because these need the account and an engine and WRITE (../docs/external.md). */}
        {externals.length ? (
          <>
            <div className="my-1 border-t border-border" />
            <div className={head}>Sur un autre appareil</div>
            {externals.map((x) => (
              <div key={x.id} className="flex items-center gap-1">
                {/* A LINK, not a command: opening it here would replace the editor, so it goes to a new tab and the copy beside it IS the command. */}
                <a
                  href={x.url}
                  target="_blank"
                  rel="noreferrer"
                  title={x.url}
                  className={`${row} min-w-0 flex-1`}
                >
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{x.id}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {x.type}
                  </span>
                </a>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Copier le lien"
                  onClick={() => onRun(`ui external ${x.id}`)}
                >
                  <ClipboardCopy className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <p className="px-2 py-1 text-xs text-muted-foreground">
              même moteur, même session : ce qui est fait là-bas est fait ici.
            </p>
          </>
        ) : null}
      </div>
    </aside>
  );
}
