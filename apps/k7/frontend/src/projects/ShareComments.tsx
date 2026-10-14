// ShareComments.tsx — what visitors wrote on ONE published snapshot, and the only screen that can
// move a comment between the three states. Opened from that share's row; the frozen viewer draws
// the same comments with a chip and no tabs. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Check, EyeOff, Loader2, RotateCcw } from "@frediverse/ui/icons";
import type { CommentState, ShareComment } from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { formatAt, inState } from "../shareComments";
import { shares as api } from "./api";

/** The three tabs, in the order a comment travels: it lands in the first and leaves for one of the others. */
const TABS: readonly { state: CommentState; label: () => string }[] = [
  { state: "active", label: () => m["comments.active"]() },
  { state: "resolved", label: () => m["comments.resolved"]() },
  { state: "ignored", label: () => m["comments.ignored"]() },
];

const stamp = (iso: string): string =>
  // The reader's own locale, not a fixed one: a date is read in the language the screen is in.
  new Date(iso).toLocaleString(getLocale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function ShareComments({
  label,
  shareKey,
  open,
  onOpenChange,
  onChanged,
}: {
  /** The share's name as its row shows it — that is what the title names. */
  label: string;
  shareKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a state change, so the row's counts re-read without waiting for the poll. */
  onChanged: () => void;
}) {
  const [comments, setComments] = useState<ShareComment[] | null>(null);
  const [tab, setTab] = useState<CommentState>("active");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!open) return;
    api
      .comments(shareKey)
      .then((r) => {
        setComments(r.comments);
        setError(null);
      })
      .catch((e: Error) => {
        setComments([]);
        setError(e.message);
      });
  }, [open, shareKey]);

  useEffect(load, [load]);

  const move = (c: ShareComment, state: CommentState) => {
    setBusy(c.id);
    setError(null);
    // Optimistic: the tab it leaves must empty under the click, and a failure puts it back by reloading.
    setComments((cur) =>
      (cur ?? []).map((x) => (x.id === c.id ? { ...x, state } : x)),
    );
    void api
      .setCommentState(shareKey, c.id, state)
      .then(onChanged)
      .catch((e: Error) => {
        setError(e.message);
        load();
      })
      .finally(() => setBusy(null));
  };

  const all = comments ?? [];
  const shown = inState(all, tab);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {m["comments.title"]({ label })}
          </DialogTitle>
          <DialogDescription>
            {parts((h) => m["comments.body"](h), {
              resolved: <b>{m["comments.resolvedWord"]()}</b>,
              ignored: <b>{m["comments.ignoredWord"]()}</b>,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-border border-b">
          {TABS.map((t) => {
            const n = inState(all, t.state).length;
            return (
              <button
                key={t.state}
                type="button"
                onClick={() => setTab(t.state)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                  tab === t.state
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label()}
                {n > 0 ? (
                  <span className="ml-1.5 text-xs tabular-nums">{n}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {comments === null ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" /> {m["common.loading"]()}
          </div>
        ) : shown.length === 0 ? (
          <p className="py-6 text-muted-foreground text-xs">
            {tab === "active"
              ? m["comments.emptyActive"]()
              : m["comments.emptyTab"]()}
          </p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col divide-y divide-border/60 overflow-y-auto">
            {shown.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-2">
                <div className="flex items-baseline gap-2">
                  {/* The timecode as text and not a link: this screen has no transport to send it to. */}
                  {c.at !== null && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] tabular-nums">
                      {formatAt(c.at)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {c.author || m["comments.anonymous"]()}
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                    {stamp(c.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {c.body}
                </p>
                <div className="flex gap-1">
                  {tab === "active" ? (
                    <>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy === c.id}
                        onClick={() => move(c, "resolved")}
                      >
                        <Check className="h-3.5 w-3.5" />{" "}
                        {m["comments.resolve"]()}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                        disabled={busy === c.id}
                        onClick={() => move(c, "ignored")}
                      >
                        <EyeOff className="h-3.5 w-3.5" />{" "}
                        {m["comments.ignore"]()}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground"
                      disabled={busy === c.id}
                      onClick={() => move(c, "active")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />{" "}
                      {m["comments.reactivate"]()}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <code className="rounded bg-muted px-2 py-1 text-red-400 text-xs">
            {error}
          </code>
        )}
      </DialogContent>
    </Dialog>
  );
}
