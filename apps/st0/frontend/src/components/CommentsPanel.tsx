// CommentsPanel.tsx — what visitors wrote on a frozen snapshot, and the box that adds one. The
// ONE thing a share is not read-only about, and the only write in this shell that does not go
// through `fsend`: it reaches pl8's public router, not a file service. See ../docs/shared.md.

import { Button } from "@frediverse/ui/button";
import type { EngineStore } from "@studio/engine-browser/store";
import type { ShareComment } from "@studio/web-protocol";
import { Loader2, MapPin, MessageSquare, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import {
  formatAt,
  newestFirst,
  rememberedName,
  rememberName,
} from "../shareComments";

/** The chip on every row. There are no TABS here: a visitor reads one list and sees what became of each. */
function StateChip({ state }: { state: ShareComment["state"] }) {
  const label =
    state === "resolved"
      ? m["share.stateResolved"]()
      : state === "ignored"
        ? m["share.stateIgnored"]()
        : m["share.stateActive"]();
  const tone =
    state === "resolved"
      ? "bg-emerald-500/15 text-emerald-500"
      : state === "ignored"
        ? "bg-muted text-muted-foreground"
        : "bg-primary/15 text-primary";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] ${tone}`}>
      {label}
    </span>
  );
}

export function CommentsPanel({
  base,
  store,
  onSeek,
  onClose,
}: {
  /** `<origin>/api/public/share/<key>` — the same base the audio hangs off. */
  base: string;
  /** Read at the moment the pin is clicked, never subscribed to: a panel that re-rendered at 60 Hz would fight the textarea. */
  store: EngineStore;
  onSeek: (seconds: number) => void;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<ShareComment[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState(rememberedName);
  const [body, setBody] = useState("");
  // The timecode is CAPTURED, not live: what the chip says is what will be filed.
  const [at, setAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/comments`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { comments: ShareComment[] };
      setComments(data.comments);
      setError("");
    } catch {
      setComments([]);
      setError(m["share.commentsFailed"]());
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`${base}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author: name.trim(), body: text, at }),
      });
      const data = (await res.json()) as {
        comment?: ShareComment;
        error?: string;
      };
      if (!res.ok || !data.comment)
        throw new Error(data.error ?? String(res.status));
      rememberName(name.trim());
      setComments((cur) => [...(cur ?? []), data.comment as ShareComment]);
      setBody("");
      setAt(null);
      listRef.current?.scrollTo({ top: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const shown = newestFirst(comments ?? []);

  return (
    <aside className="flex w-[22rem] min-w-0 shrink-0 flex-col border-l border-border bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {m["share.comments"]()}
        </span>
        <Button size="icon" variant="ghost" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Said once, at the top: a visitor has no other way to learn that this is public and that it is not theirs to resolve. */}
      <p className="shrink-0 border-b border-border px-3 py-2 text-muted-foreground text-xs">
        {m["share.commentsHint"]()}
      </p>

      <ul
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col divide-y divide-border/60 overflow-y-auto"
      >
        {comments === null ? (
          <li className="flex items-center gap-2 p-3 text-muted-foreground text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
          </li>
        ) : shown.length === 0 ? (
          <li className="p-3 text-muted-foreground text-xs">
            {m["share.commentsEmpty"]()}
          </li>
        ) : (
          shown.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex items-baseline gap-2">
                {/* The timecode is a BUTTON: a comment about a moment is worth nothing if reaching it is a scrub. */}
                {c.at !== null && (
                  <button
                    type="button"
                    title={m["share.commentSeek"]()}
                    onClick={() => onSeek(c.at as number)}
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] tabular-nums hover:bg-accent"
                  >
                    {formatAt(c.at)}
                  </button>
                )}
                <span className="min-w-0 flex-1 truncate text-xs">
                  {c.author || m["share.commentAnon"]()}
                </span>
                <StateChip state={c.state} />
              </div>
              {/* Written as typed: a comment is a BLOCK of text, and its line breaks are what it meant. */}
              <p className="whitespace-pre-wrap break-words text-sm">
                {c.body}
              </p>
            </li>
          ))
        )}
      </ul>

      <div className="flex shrink-0 flex-col gap-2 border-border border-t p-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={m["share.commentName"]()}
          className="rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-primary"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={m["share.commentBody"]()}
          rows={3}
          className="resize-none rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-primary"
        />
        <div className="flex items-center gap-2">
          <Button
            variant={at === null ? "ghost" : "secondary"}
            size="sm"
            title={
              at === null ? m["share.commentPin"]() : m["share.commentUnpin"]()
            }
            onClick={() =>
              setAt(at === null ? store.getSnapshot().playhead : null)
            }
          >
            <MapPin className="h-4 w-4" />
            {at === null ? null : (
              <span className="font-mono tabular-nums">{formatAt(at)}</span>
            )}
          </Button>
          <Button
            className="ml-auto"
            size="sm"
            disabled={!body.trim() || sending}
            onClick={() => void send()}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {m["share.commentSend"]()}
          </Button>
        </div>
        {error && <code className="text-red-400 text-xs">{error}</code>}
      </div>
    </aside>
  );
}
