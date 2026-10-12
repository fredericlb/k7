// HistoryPanel.tsx — the open project's history as one list on the right: the undo journal's
// steps, newest first. Hovering a row lights what it touched on the graph and the timeline
// (historyMarks.ts); the panel itself changes nothing.
// The journal's undone steps stay listed, dimmed: they are what Ctrl+Y would bring back.

import { Button } from "@frediverse/ui/button";
import { History, Undo2, X } from "@frediverse/ui/icons";
import type { WebGraph } from "@studio/graph-model";
import type { HistoryListEntry } from "@studio/web-protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { type HistoryMark, historyMarks } from "../historyMarks";
import { useQuietWrites, useRevision } from "../hooks/useRevision";
import { m } from "../paraglide/messages.js";

const time = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
const day = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

export function HistoryPanel({
  onMark,
  onClose,
}: {
  /** What the hovered row touched, or null when none is — the graph and the timeline light it. */
  onMark: (mark: HistoryMark | null) => void;
  onClose: () => void;
}) {
  const [steps, setSteps] = useState<HistoryListEntry[]>([]);
  const [graph, setGraph] = useState<WebGraph | null>(null);
  const [error, setError] = useState("");
  const revision = useRevision();
  // …and this tab's own knob writes, which are journalled rows too but move no published token.
  const quietWrites = useQuietWrites();

  const refresh = useCallback(async () => {
    try {
      const [s, g] = await Promise.all([
        api.historyEntries(),
        // Only to tell which node of a touched chain a step's label names; a graph that will not build lights the chain.
        api.graph().catch(() => null),
      ]);
      setSteps(s);
      setGraph(g);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  // On open, and whenever the workspace's revision moves — every edit and every undo is a new row or a moved cursor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the trigger, not an input.
  useEffect(() => {
    void refresh();
  }, [refresh, revision, quietWrites]);
  // Nothing stays lit once the panel is gone.
  useEffect(() => () => onMark(null), [onMark]);

  // Newest first, whatever order the journal answers in.
  const rows = useMemo(() => [...steps].sort((a, b) => b.ts - a.ts), [steps]);

  return (
    <aside className="flex w-[24rem] min-w-0 shrink-0 flex-col border-border border-l bg-background">
      <header className="flex shrink-0 items-center gap-1 border-border border-b px-2 py-1.5">
        <History className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate px-1.5 text-sm">
          {m["history.title"]()}
        </span>
        <Button
          size="icon"
          variant="ghost"
          title={m["common.close"]()}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>
      {error && (
        <div className="shrink-0 px-3 py-2 text-destructive text-xs">
          {error}
        </div>
      )}
      <ul
        className="min-h-0 flex-1 overflow-y-auto py-1 text-xs"
        onMouseLeave={() => onMark(null)}
      >
        {rows.length === 0 && !error && (
          <li className="px-3 py-2 text-muted-foreground">
            {m["history.empty"]()}
          </li>
        )}
        {rows.map((r, i) => {
          const newDay = i === 0 || day(rows[i - 1].ts) !== day(r.ts);
          const { paths, label, undone } = r;
          return (
            <li key={r.id}>
              {newDay && (
                <div className="px-3 pt-2 pb-1 text-[10px] text-muted-foreground uppercase tracking-wide">
                  {day(r.ts)}
                </div>
              )}
              <div
                className={`flex cursor-default items-start gap-2 px-3 py-1 hover:bg-accent ${undone ? "opacity-50" : ""}`}
                title={`${label}\n${paths.join("\n")}`}
                onMouseEnter={() => onMark(historyMarks(paths, label, graph))}
              >
                <span className="w-10 shrink-0 pt-px font-mono text-[10px] text-muted-foreground">
                  {time(r.ts)}
                </span>
                {undone ? (
                  <Undo2 className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono">
                  {label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
