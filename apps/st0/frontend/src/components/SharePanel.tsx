// SharePanel.tsx — render the project through the engine (MP3/WAV download, or publish to k7
// with per-track stems), publish a frozen link, and run commit/pull on the WHOLE workspace repo.
// A PANEL anchored at the right, docked beside the panes: it was a dropdown, and a dropdown is
// the wrong shape for a surface that reports — a pull says how far behind you were, an export
// takes a minute and says where the file went. See ../docs/shell.md.
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

/** One surface's address, ready to hand over. Computed by `App`, which is where the launch
 *  parameters and the surface list both are; this panel only draws them. */
export type SurfaceLink = { id: string; type: string; url: string };

/** The badge the header's button wears: `!` for a diverged branch, else the commits waiting.
 *  Exported so the button and the panel cannot disagree about what the repo is doing. */
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
  /** The surfaces this project declares that a second device can drive. Empty is the normal
   *  case — most projects declare a timeline and nothing else — and the section is then absent
   *  rather than empty. */
  externals: readonly SurfaceLink[];
  onRun: (command: string) => void;
  onClose: () => void;
}) {
  const { behind, conflicted } = shareBadge(gitStatus);

  const row =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50";
  const head = "px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground";

  // `project commit` takes the message as the rest of its line, so this asks for one before
  // dispatching — an empty prompt is a cancelled commit, not a command run with no message.
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
        {/* Said in the panel and not only in a tooltip on the button: a branch that cannot
            fast-forward needs a merge by hand, and that is a sentence, not a badge. */}
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
        {/* The two that PUBLISH, and they publish different things: k7 gets a release, a link
            gets a frozen copy of the project itself — playable and readable by anyone who has
            it, with no account and no engine. See packages/commands/docs/shareBundle.md. */}
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

        {/* The addresses of this project's own surfaces — `<projet>/@external/<nom>`, one screen
            alone on a second device, driving THIS engine. Here because this panel is already
            where every address the project hands out is found, and because the gesture is the
            same one: you are giving somebody — or some tablet — a link.

            It is not a share, and the two sit apart for that reason: a share is frozen,
            account-less and read-only, while this needs the account, needs an engine, and WRITES.
            Only the types another device can actually drive are listed; every surface has an
            address, but a timeline opened this way would only say so. See ../docs/external.md. */}
        {externals.length ? (
          <>
            <div className="my-1 border-t border-border" />
            <div className={head}>Sur un autre appareil</div>
            {externals.map((x) => (
              <div key={x.id} className="flex items-center gap-1">
                {/* A LINK, not a command: opening it here would replace the editor you are
                    standing in front of, so it goes to a new tab and the address bar is what
                    carries it to the phone. The copy beside it IS the command. */}
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
