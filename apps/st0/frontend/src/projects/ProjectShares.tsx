// ProjectShares.tsx — a project row's "Partages" button and the popin it opens: the frozen
// snapshots THIS project published, with the one place a share is withdrawn. The cost in bytes is
// said there too — a share never expires. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import {
  Check,
  Copy,
  Loader2,
  MessageSquare,
  Trash2,
} from "@frediverse/ui/icons";
import { askConfirm } from "@studio/project-shell/ask";
import type { ShareSummary } from "@studio/web-protocol";
import { useState } from "react";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";
import { shares as api } from "./api";
import { ShareComments } from "./ShareComments";
import { liveCount } from "./sharesForProject";

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

/** The day, without the hour: what tells two snapshots of the same song apart. */
const day = (iso: string): string =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function ProjectShares({
  label,
  shares,
  onChanged,
}: {
  /** The project's name as the row shows it — that is what the title names. */
  label: string;
  /** THIS project's shares, revoked ones included (`sharesOf`). */
  shares: ShareSummary[];
  /** After a revoke, so the page re-reads without waiting for the poll. */
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which share's comments are open, or null — one dialog over this one, since comments belong to ONE snapshot.
  const [reading, setReading] = useState<ShareSummary | null>(null);

  const live = liveCount(shares);
  // What this weighs on the volume, in one number: a share does not expire, so seeing what they cost together is the only prompt.
  const total = shares
    .filter((s) => !s.revokedAt)
    .reduce((n, s) => n + s.bytes, 0);

  const copy = (s: ShareSummary) => {
    void navigator.clipboard.writeText(api.url(s.token)).then(
      () => {
        setCopied(s.key);
        setTimeout(() => setCopied(null), 1500);
      },
      // A refused clipboard must not lose the link: it is written beside it, on the row, and stays selectable by hand.
      () => setError(m["shares.clipboardRefused"]()),
    );
  };

  const revoke = async (s: ShareSummary) => {
    // The sentence names what goes and what stays, because both surprise: the bytes vanish at once, and a link sent cannot be unsent.
    const agreed = await askConfirm({
      title: m["shares.revokeTitle"]({ name: s.name || label }),
      body: m["shares.revokeBody"](),
      confirmLabel: m["common.remove"](),
      danger: true,
    });
    if (!agreed) return;
    setBusy(s.key);
    setError(null);
    void api
      .revoke(s.key)
      .then(onChanged)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  return (
    <>
      {/* Discreet, like Supprimer beside it, and carrying the count so the button itself says which project has shares. */}
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        title={
          live > 0
            ? m["shares.publishedCount"]({
                n: live,
                s: live > 1 ? "s" : "",
                size: bytes(total),
              })
            : m["shares.noneFor"]({ label })
        }
        onClick={(e) => {
          // The whole row is a link to the project: without this, the button would open it.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {m["shares.button"]()}
        {live > 0 ? ` (${live})` : ""}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-baseline gap-2">
              <span className="truncate">{m["shares.title"]({ label })}</span>
              {live > 0 && (
                <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                  {m["shares.linkCount"]({
                    n: live,
                    s: live > 1 ? "s" : "",
                    size: bytes(total),
                  })}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {parts((h) => m["shares.body"](h), {
                frozen: <b>{m["shares.frozenWord"]()}</b>,
                cmd: <code>project share link</code>,
                noexpiry: <b>{m["shares.noExpiryWord"]()}</b>,
              })}
            </DialogDescription>
          </DialogHeader>

          {shares.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {m["shares.none"]()}
            </p>
          ) : (
            <ul className="flex max-h-[50vh] flex-col divide-y divide-border/60 overflow-y-auto">
              {shares.map((s) => {
                const url = s.token ? api.url(s.token) : "";
                return (
                  <li key={s.key} className="flex items-center gap-2 py-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-baseline gap-2 text-sm">
                        <span className="truncate">{s.name || label}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {day(s.createdAt)}
                        </span>
                        {s.revokedAt && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            retiré le {day(s.revokedAt)}
                          </span>
                        )}
                      </div>
                      {/* The address is a LINK: opening it is the only way to check what the people you sent it to see; `noopener` because that page is public. */}
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          {url}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {m["shares.linkGone"]()}
                        </span>
                      )}
                    </div>

                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {s.revokedAt ? "—" : bytes(s.bytes)}
                    </span>

                    {/* Present even when the bytes are gone: a revoked share keeps what was written on it. */}
                    <Button
                      variant="ghost"
                      size="xs"
                      className="shrink-0 text-muted-foreground text-xs hover:text-foreground"
                      title={m["shares.commentsHint"]({
                        name: s.name || label,
                      })}
                      onClick={() => setReading(s)}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      {m["shares.comments"]()}
                      {s.comments && s.comments.active > 0 ? (
                        <span className="tabular-nums">
                          ({s.comments.active})
                        </span>
                      ) : null}
                    </Button>

                    {url && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copy(s)}
                      >
                        {copied === s.key ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {!s.revokedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void revoke(s)}
                        disabled={busy === s.key}
                      >
                        {busy === s.key ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {error && (
            <code className="rounded bg-muted px-2 py-1 text-xs text-red-400">
              {error}
            </code>
          )}
        </DialogContent>
      </Dialog>

      {reading && (
        <ShareComments
          label={reading.name || label}
          shareKey={reading.key}
          open
          onOpenChange={(o) => {
            if (!o) setReading(null);
          }}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
