// ShareMenu.tsx — the share dropdown: render the project through the engine (MP3/WAV
// download, or publish to radiok7 with per-track stems) and run the shared commit/pull
// commands on the WHOLE workspace repo. The heavy work happens on the engine host; this
// kicks it off and reports on the status line. The badge shows commits BEHIND, or a
// warning when the branch has diverged.

import { Button } from "@frediverse/ui/button";
import {
  Download,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Radio,
  Share2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { GitStatus } from "../types";

// Save a fetched blob to the user's disk under `filename`.
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ShareMenu({
  onStatus,
  gitStatus,
  onRepoChanged,
}: {
  onStatus: (s: string) => void;
  gitStatus: GitStatus | null;
  // Called after a commit/pull so the shell refreshes the badge, the view and the workspace.
  onRepoChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const exportMix = async (format: "wav" | "mp3") => {
    setOpen(false);
    setBusy(true);
    onStatus(`rendering ${format.toUpperCase()} mixdown…`);
    try {
      const { blob, filename } = await api.exportMix(format);
      download(blob, filename);
      onStatus(`exported ${filename}`);
    } catch (e) {
      onStatus(`export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const shareRadiok7 = async () => {
    setOpen(false);
    setBusy(true);
    onStatus("publishing to radiok7…");
    try {
      let res = await api.shareRadiok7();
      // A song radiok7 doesn't know yet: ask for artist/title, then publish for real.
      if (res.needsMeta) {
        const artist = window
          .prompt("Artist (new radiok7 release):", "")
          ?.trim();
        if (!artist) {
          onStatus("radiok7 publish cancelled");
          return;
        }
        const title =
          window.prompt("Title:", res.defaultTitle || "")?.trim() ||
          res.defaultTitle ||
          "";
        onStatus("publishing to radiok7…");
        res = await api.shareRadiok7({ artist, title });
      }
      if (res.ok)
        onStatus(
          `${res.created ? "created release" : "added a version"}: ${res.title} ` +
            `(${res.stems ?? 0} stem${res.stems === 1 ? "" : "s"})`,
        );
      else onStatus("radiok7 publish did not complete");
    } catch (e) {
      onStatus(`radiok7 publish failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Stage + commit + push the WHOLE workspace repo; the message is prompted for, the result hits the status line.
  const commit = async () => {
    const message = window
      .prompt("Commit message (stages + pushes the whole repo):", "")
      ?.trim();
    if (!message) {
      onStatus("commit cancelled");
      return;
    }
    setOpen(false);
    setBusy(true);
    onStatus("committing…");
    try {
      const r = await api.gitCommit(message);
      if (r.nothingToCommit) onStatus("nothing to commit — the repo is clean");
      else {
        const files = `${r.changed} file${r.changed === 1 ? "" : "s"}`;
        onStatus(
          `committed ${r.sha} (${files})` +
            (r.pushed ? " · pushed" : ` · push failed: ${r.pushError}`),
        );
      }
    } catch (e) {
      onStatus(`commit failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      onRepoChanged();
    }
  };

  // Fast-forward the WHOLE workspace repo from its remote (no active project needed).
  const pull = async () => {
    setOpen(false);
    setBusy(true);
    onStatus("pulling…");
    try {
      const r = await api.gitPull();
      onStatus(r.upToDate ? "already up to date" : `pulled — ${r.summary}`);
    } catch (e) {
      onStatus(`pull failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      onRepoChanged();
    }
  };

  // The badge: a warning when the branch diverged (a pull needs a manual merge), else the commits waiting.
  const behind = gitStatus?.tracked ? gitStatus.behind : 0;
  const conflicted = !!gitStatus?.conflicted;
  const badge = conflicted ? "!" : behind > 0 ? String(behind) : null;

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50";

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
          <button
            className={item}
            disabled={busy}
            onClick={() => void commit()}
          >
            <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" />
            Commit &amp; push…
          </button>
          <button className={item} disabled={busy} onClick={() => void pull()}>
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
            onClick={() => void exportMix("mp3")}
          >
            <Download className="h-4 w-4 text-muted-foreground" />
            Export MP3
          </button>
          <button
            className={item}
            disabled={busy}
            onClick={() => void exportMix("wav")}
          >
            <Download className="h-4 w-4 text-muted-foreground" />
            Export WAV
          </button>
          <div className="my-1 border-t border-border" />
          <button
            className={item}
            disabled={busy}
            onClick={() => void shareRadiok7()}
          >
            <Radio className="h-4 w-4 text-muted-foreground" />
            Share to radiok7
          </button>
        </div>
      )}
    </div>
  );
}
