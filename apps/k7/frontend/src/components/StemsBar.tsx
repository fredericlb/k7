// StemsBar.tsx — preparing a whole set list's stems: which chain this machine separates with, and
// how far the run has got — a bar rather than a dialogue, since it runs for an hour.
// See ../../docs/playlists.md.

import { Button } from "@frediverse/ui/button";
import { Split, Square, X } from "@frediverse/ui/icons";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";

/** Separating the whole set list, as it is going — one object, since every tick moves several of these and a half-updated bar lies. */
export interface Run {
  /** Lines with audio to separate, and how many are behind us. */
  total: number;
  done: number;
  /** What is being worked on now, and how far its job says it is. */
  label: string;
  percent: number | null;
  /** Already prepared, so nothing was spent on them — counted apart from `done`, which is what makes a re-run cheap. */
  skipped: number;
  /** One line per song that could not be done — never a reason to stop the other eleven. */
  notes: string[];
  /** Set when the loop has left, whether it finished, was stopped or gave up. */
  over: boolean;
}

/** Preparing the whole set list: which chain, and how far it has got — a bar rather than a dialogue, since this runs for an hour. */
export function StemsBar({
  chain,
  playable,
  run,
  onStart,
  onStop,
  onSettings,
  onClose,
}: {
  /** The chain this MACHINE separates with: `null` for 'never told', `undefined` while the preference is being read. */
  chain: string | null | undefined;
  /** How many lines have audio — what the run will actually go through. */
  playable: number;
  run: Run | null;
  onStart: () => void;
  onStop: () => void;
  /** Open the settings, where the chain is set. Absent in a host with no command bar. */
  onSettings?: () => void;
  onClose: () => void;
}) {
  const busy = !!run && !run.over;
  /** The bar's fill, 0..1 — songs finished PLUS how far into the one in hand, neither half being honest alone. */
  const at = run
    ? Math.min(1, (run.done + (run.percent ?? 0) / 100) / (run.total || 1))
    : 0;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <Split className="h-4 w-4 shrink-0 text-muted-foreground" />
        {/* WHICH chain separates is one answer for the machine, set in k7's settings (or `system stems`) and only shown here (docs/playlists.md). */}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {chain === undefined ? "…" : (chain ?? m["clip.noChain"]())}
        </span>
        {busy ? (
          <Button size="sm" variant="secondary" onClick={onStop}>
            <Square className="mr-1 h-3.5 w-3.5" /> {m["pl.stop"]()}
          </Button>
        ) : (
          <Button size="sm" disabled={!chain || !playable} onClick={onStart}>
            {m["pl.start"]({ n: playable })}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          aria-label={m["common.close"]()}
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Told nothing yet: the one sentence that unblocks it, and the way there — not a picker, the machine being asked once. */}
      {chain === null ? (
        <p className="text-xs text-muted-foreground">
          {parts((h) => m["pl.noChainYet"](h), {
            cmd: <span className="font-mono">system stems @k7-core/stems</span>,
          })}
          {onSettings ? (
            <Button
              size="sm"
              variant="secondary"
              className="ml-2 h-6"
              onClick={onSettings}
            >
              {m["settings.title"]()}
            </Button>
          ) : null}
        </p>
      ) : null}

      {/* Before anything has been asked for: what this costs, said up front rather than found out by watching twelve songs run. */}
      {run || chain === null ? null : (
        <p className="text-xs text-muted-foreground">
          {m["pl.separateCost"]()}
        </p>
      )}

      {run ? (
        <>
          {/* A div with the role rather than a <progress>: the native element cannot be drawn as this shell's flat rule. */}
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={run.total}
            aria-valuenow={run.done}
            className="h-1 w-full overflow-hidden rounded bg-border"
          >
            <div
              className="h-full bg-foreground transition-[width] duration-300"
              style={{ width: `${Math.round(at * 100)}%` }}
            />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {run.over
              ? m["pl.runDone"]({ done: run.done, total: run.total }) +
                (run.skipped
                  ? ` · ${m["pl.runSkipped"]({ n: run.skipped })}`
                  : "")
              : `${run.done + 1}/${run.total} · ${run.label}` +
                (run.percent == null ? " …" : ` · ${run.percent}%`)}
          </p>
          {/* Never swallowed: a song the machine has not pulled is exactly what somebody needs to see after an overnight run. */}
          {run.notes.map((n) => (
            <p key={n} className="truncate text-xs text-destructive" title={n}>
              {n}
            </p>
          ))}
        </>
      ) : null}
    </div>
  );
}
