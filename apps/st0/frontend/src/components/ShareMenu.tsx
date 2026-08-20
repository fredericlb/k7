// ShareMenu.tsx — the share dropdown: render the project through the engine (MP3/WAV
// download, or publish to k7 with per-track stems) and run commit/pull on the WHOLE workspace
// repo. The badge shows commits BEHIND, or a warning when the branch has diverged.
//
// Every entry is a COMMAND LINE the shell dispatches, not a call of its own: two of them are
// CLI verbs (`project commit`, `project pull`) and two are the shell's (`project export`,
// `project share k7`). That is what keeps the menu and the palette saying the same thing.

import { Button } from "@frediverse/ui/button";
import {
  Download,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Link2,
  Radio,
  Share2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GitStatus } from "../types";

export function ShareMenu({
  gitStatus,
  busy,
  onRun,
}: {
  gitStatus: GitStatus | null;
  /** A render is already running — the menu greys out rather than starting a second. */
  busy: boolean;
  /** Run one of the four lines. The shell dispatches it, so the palette remembers it too. */
  onRun: (command: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  // The badge: a warning when the branch diverged (a pull needs a manual merge), else the commits waiting.
  const behind = gitStatus?.tracked ? gitStatus.behind : 0;
  const conflicted = !!gitStatus?.conflicted;
  const badge = conflicted ? "!" : behind > 0 ? String(behind) : null;

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50";
  const run = (command: string) => {
    setOpen(false);
    onRun(command);
  };
  // `project commit` takes the message as the rest of its line, so the menu asks for one before
  // dispatching — an empty prompt is a cancelled commit, not a command run with no message.
  const commit = () => {
    const message = window
      .prompt("Commit message (stages + pushes the whole repo):", "")
      ?.trim();
    if (message) run(`project commit ${message}`);
    else setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Button
        size="icon"
        variant="ghost"
        className="relative"
        aria-expanded={open}
        disabled={busy}
        title={
          conflicted
            ? "Share / export — repo diverged, can't fast-forward (pull needs a merge)"
            : behind > 0
              ? `Share / export — ${behind} commit${behind === 1 ? "" : "s"} to pull`
              : "Share / export"
        }
        aria-label="Share / export"
        onClick={() => setOpen((o) => !o)}
      >
        <Share2 className="h-4 w-4" />
        {badge && (
          <span
            className={
              "absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white " +
              (conflicted ? "bg-amber-500" : "bg-primary")
            }
          >
            {badge}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-popover p-2 shadow-lg">
          <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">
            Version control
          </div>
          <button className={item} disabled={busy} onClick={commit}>
            <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" />
            Commit &amp; push…
          </button>
          <button
            className={item}
            disabled={busy}
            onClick={() => run("project pull")}
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
          <div className="my-1 border-t border-border" />
          <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">
            Mixdown
          </div>
          <button
            className={item}
            disabled={busy}
            onClick={() => run("project export mp3")}
          >
            <Download className="h-4 w-4 text-muted-foreground" />
            Export MP3
          </button>
          <button
            className={item}
            disabled={busy}
            onClick={() => run("project export wav")}
          >
            <Download className="h-4 w-4 text-muted-foreground" />
            Export WAV
          </button>
          <div className="my-1 border-t border-border" />
          {/* The two that PUBLISH, and they publish different things: k7 gets a release, a link
              gets a frozen copy of the project itself — playable and readable by anyone who has
              it, with no account and no engine. See packages/commands/docs/shareBundle.md. */}
          <button
            className={item}
            disabled={busy}
            onClick={() => run("project share link")}
          >
            <Link2 className="h-4 w-4 text-muted-foreground" />
            Partager un lien
          </button>
          <button
            className={item}
            disabled={busy}
            onClick={() => run("project share k7")}
          >
            <Radio className="h-4 w-4 text-muted-foreground" />
            Share to k7
          </button>
        </div>
      )}
    </div>
  );
}
