// HistoryPanel.tsx — the open project's history on the right: the undo journal's steps, newest
// first, and under them the WORKSPACE's sync history (syncHistory.ts) — checkpoints and edits.
// Hovering a journal row lights what it touched (historyMarks.ts); the journal changes nothing.
// Restoring is the one write here, and it is a sync edit like any other: packages/file-hub/docs/history.md.

import { Button } from "@frediverse/ui/button";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  History,
  RotateCcw,
  Undo2,
  X,
} from "@frediverse/ui/icons";
import { askConfirm, askText } from "@studio/project-shell/ask";
import { cfg } from "@studio/project-shell/fileApi";
import type { HistoryListEntry } from "@studio/web-protocol";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../api";
import { type HistoryMark, historyMarks } from "../historyMarks";
import { useQuietWrites, useRevision } from "../hooks/useRevision";
import { m } from "../paraglide/messages.js";
import { usePaneGraph } from "../queries/graph";
import { useReloadKey } from "../state/shellStore";
import { type SyncChange, type SyncHistory, syncHistory } from "../syncHistory";

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
  // Only to tell which node of a touched chain a step's label names; a graph that will not build lights the chain.
  const { graph } = usePaneGraph(useReloadKey());
  const [error, setError] = useState("");
  const revision = useRevision();
  // …and this tab's own knob writes, which are journalled rows too but move no published token.
  const quietWrites = useQuietWrites();

  const refresh = useCallback(async () => {
    try {
      setSteps(await api.historyEntries());
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
        className="min-h-0 flex-1 basis-1/2 overflow-y-auto py-1 text-xs"
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
                role="note"
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
      <SyncHistorySection revision={revision} />
    </aside>
  );
}

/** One file's change, before and after as plain text; a binary file is only named. */
function ChangeView({ c }: { c: SyncChange }) {
  const side = (label: string, text: string | null) => (
    <div className="min-w-0 flex-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-1 text-[10px]">
        {text ?? "—"}
      </pre>
    </div>
  );
  return (
    <div className="px-3 py-1">
      <div className="truncate font-mono text-[11px]">{c.file}</div>
      {c.binary ? (
        <div className="text-muted-foreground">{m["synchist.binary"]()}</div>
      ) : (
        <div className="flex gap-1">
          {side(m["synchist.before"](), c.before)}
          {side(m["synchist.after"](), c.after)}
        </div>
      )}
    </div>
  );
}

/** The workspace's sync history: its checkpoints and latest edits, each one restorable and openable. */
function SyncHistorySection({ revision }: { revision: unknown }) {
  const workspace = cfg().workspace;
  const [hist, setHist] = useState<SyncHistory | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [changes, setChanges] = useState<SyncChange[] | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace) return;
    try {
      setHist(await syncHistory.list(workspace));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspace]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the trigger, not an input.
  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  // A row opens on what it changed: an entry against the point before it, a checkpoint against now.
  const toggle = async (key: string, from: number, to: number) => {
    if (open === key) return setOpen(null);
    setOpen(key);
    setChanges(null);
    try {
      setChanges(await syncHistory.diff(workspace, from, to));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const name = async () => {
    const n = await askText({
      title: m["synchist.namePrompt"](),
      placeholder: m["synchist.namePlaceholder"](),
      confirmLabel: m["synchist.nameConfirm"](),
      cancelLabel: m["common.cancel"](),
      validate: (v) => (v.trim() ? "" : m["synchist.nameEmpty"]()),
    });
    if (!n) return;
    await syncHistory
      .checkpoint(workspace, n.trim())
      .catch((e: Error) => setError(e.message));
    void refresh();
  };

  const restore = async (seq: number, point: string) => {
    const ok = await askConfirm({
      title: m["synchist.restoreTitle"]({ point }),
      body: m["synchist.restoreBody"](),
      confirmLabel: m["synchist.restoreConfirm"](),
      cancelLabel: m["common.cancel"](),
      danger: true,
    });
    if (!ok) return;
    await syncHistory
      .restore(workspace, seq)
      .catch((e: Error) => setError(e.message));
    void refresh();
  };

  if (!workspace) return null;
  const head = hist?.head ?? 0;
  const row = (
    key: string,
    ts: number,
    label: string,
    from: number,
    to: number,
    seq: number,
    point: string,
    icon: ReactNode,
  ) => (
    <li key={key}>
      <div className="group flex items-start gap-2 px-3 py-1 hover:bg-accent">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          onClick={() => void toggle(key, from, to)}
        >
          {open === key ? (
            <ChevronDown className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="w-10 shrink-0 pt-px font-mono text-[10px] text-muted-foreground">
            {time(ts)}
          </span>
          {icon}
          <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
        </button>
        <button
          type="button"
          className="shrink-0 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
          title={m["synchist.restore"]()}
          onClick={() => void restore(seq, point)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      {open === key &&
        (changes === null ? null : changes.length === 0 ? (
          <div className="px-3 py-1 text-muted-foreground">
            {m["synchist.noChange"]()}
          </div>
        ) : (
          changes.map((c) => <ChangeView key={c.file} c={c} />)
        ))}
    </li>
  );

  return (
    <section className="flex min-h-0 flex-1 basis-1/2 flex-col border-border border-t text-xs">
      <header className="flex shrink-0 items-center gap-1 px-2 py-1">
        <span className="min-w-0 flex-1 truncate px-1.5 text-muted-foreground uppercase tracking-wide text-[10px]">
          {m["synchist.title"]()}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void name()}>
          <Bookmark className="h-3.5 w-3.5" />
          {m["synchist.name"]()}
        </Button>
      </header>
      {error && (
        <div className="shrink-0 px-3 py-1 text-destructive">{error}</div>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto pb-1">
        {hist && hist.checkpoints.length === 0 && hist.entries.length === 0 && (
          <li className="px-3 py-2 text-muted-foreground">
            {m["synchist.empty"]()}
          </li>
        )}
        {[...(hist?.checkpoints ?? [])]
          .reverse()
          .map((c) =>
            row(
              `c${c.seq}-${c.ts}`,
              c.ts,
              c.by === "auto" ? m["synchist.auto"]() : c.name,
              c.seq,
              head,
              c.seq,
              c.by === "auto" ? String(c.seq) : c.name,
              <Bookmark className="mt-px h-3.5 w-3.5 shrink-0 text-primary-text" />,
            ),
          )}
        {(hist?.entries ?? []).map((e) =>
          row(
            `e${e.seq}`,
            e.ts,
            e.parked
              ? `${e.label} · ${m["synchist.parked"]({ count: e.parked })}`
              : e.label,
            e.seq - 1,
            e.seq,
            e.seq,
            String(e.seq),
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />,
          ),
        )}
      </ul>
    </section>
  );
}
