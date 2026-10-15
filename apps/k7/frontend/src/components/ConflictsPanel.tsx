// ConflictsPanel.tsx — the workspace's open sync conflicts: a footer tab with their count, the
// right-column panel that settles each one, and the banner over the editor of a file that has one.
// Settling is the file service's (`POST /sync/conflicts/:id`); nothing here edits a file. See docs/conflicts.md.

import { Button } from "@frediverse/ui/button";
import { GitMerge, TriangleAlert, X } from "@frediverse/ui/icons";
import { useState } from "react";
import { useConflicts } from "../hooks/useConflicts";
import { m } from "../paraglide/messages.js";
import {
  conflictsApi,
  describeConflict,
  openConflictsPanel,
  type Side,
  type SyncConflict,
} from "../syncConflicts";
import { FooterTab } from "./FooterTab";

const when = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** The footer tab: drawn only while the workspace has an open conflict, with their count. */
export function ConflictsTab({
  active,
  plain,
  onClick,
}: {
  active: boolean;
  plain?: boolean;
  onClick: () => void;
}) {
  const { conflicts } = useConflicts();
  if (conflicts.length === 0 && !active) return null;
  const label = m["conflicts.tab"]({ count: conflicts.length });
  return (
    <FooterTab
      plain={plain}
      active={active}
      title={label}
      aria-label={label}
      onClick={onClick}
      className="text-amber-500"
    >
      <GitMerge className="h-4 w-4" />
      <span className="text-xs tabular-nums">{conflicts.length}</span>
    </FooterTab>
  );
}

function SideView({ label, side }: { label: string; side: Side }) {
  const text =
    side.k === "value"
      ? side.source
      : side.k === "absent"
        ? m["conflicts.absent"]()
        : side.k === "text"
          ? m["conflicts.wholeText"]()
          : side.k === "binary"
            ? m["conflicts.binary"]()
            : side.k === "removed"
              ? m["conflicts.removed"]()
              : m["conflicts.current"]();
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <pre
        className={`max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-1 text-[10px] ${side.k === "value" ? "font-mono" : "italic text-muted-foreground"}`}
      >
        {text}
      </pre>
    </div>
  );
}

function ConflictRow({
  c,
  busy,
  onSettle,
}: {
  c: SyncConflict;
  busy: boolean;
  onSettle: (take: boolean) => void;
}) {
  const v = describeConflict(c);
  return (
    <li className="flex flex-col gap-1 border-border border-b px-3 py-2">
      <div className="truncate font-mono text-[11px]" title={v.file}>
        {v.file}
      </div>
      {v.paths.length > 0 && (
        <div className="truncate font-mono text-[11px] text-amber-500">
          {v.paths.join(", ")}
        </div>
      )}
      <div className="flex gap-1">
        <SideView label={m["conflicts.kept"]()} side={v.kept} />
        <SideView label={m["conflicts.alternative"]()} side={v.alternative} />
      </div>
      <div className="text-[10px] text-muted-foreground">
        {m["conflicts.by"]({ replica: c.replica, when: when(c.ts) })}
        {c.label ? ` — ${c.label}` : ""}
      </div>
      <div className="flex justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onSettle(false)}
        >
          {m["conflicts.keep"]()}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onSettle(true)}
        >
          {m["conflicts.take"]()}
        </Button>
      </div>
    </li>
  );
}

/** The right column's panel: every open conflict, with the value kept and the one set aside. */
export function ConflictsPanel({ onClose }: { onClose: () => void }) {
  const { conflicts, error, refresh } = useConflicts();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState("");

  const settle = async (id: string, take: boolean) => {
    setBusy(id);
    try {
      await conflictsApi.settle(id, take);
      setFailed("");
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  return (
    <aside className="flex w-[24rem] min-w-0 shrink-0 flex-col border-border border-l bg-background">
      <header className="flex shrink-0 items-center gap-1 border-border border-b px-2 py-1.5">
        <GitMerge className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate px-1.5 text-sm">
          {m["conflicts.title"]()}
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
      {(failed || error) && (
        <div className="shrink-0 px-3 py-2 text-destructive text-xs">
          {failed || error}
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto text-xs">
        {conflicts.length === 0 && !error && (
          <li className="px-3 py-2 text-muted-foreground">
            {m["conflicts.empty"]()}
          </li>
        )}
        {conflicts.map((c) => (
          <ConflictRow
            key={c.id}
            c={c}
            busy={busy !== null}
            onSettle={(take) => void settle(c.id, take)}
          />
        ))}
      </ul>
    </aside>
  );
}

/** Over the editor of a file with open conflicts: which paths, and the way to the panel. */
export function ConflictBanner({ file }: { file: string | null }) {
  const { conflicts } = useConflicts();
  if (!file) return null;
  const mine = conflicts.filter((c) => c.op.file === file);
  if (mine.length === 0) return null;
  const paths = [...new Set(mine.flatMap((c) => describeConflict(c).paths))];
  return (
    <div className="flex shrink-0 items-center gap-2 border-amber-500/30 border-b bg-amber-500/10 px-3 py-1 text-amber-600 text-xs dark:text-amber-400">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-mono">
        {paths.length > 0
          ? m["conflicts.banner"]({ paths: paths.join(", ") })
          : m["conflicts.bannerWhole"]()}
      </span>
      <Button size="sm" variant="ghost" onClick={openConflictsPanel}>
        {m["conflicts.review"]()}
      </Button>
    </div>
  );
}
