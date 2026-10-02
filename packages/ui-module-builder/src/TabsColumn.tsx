// TabsColumn.tsx — the builder's tab list, a column at the grid's LEFT as the card draws its own:
// "Every tab" for the widgets each page shows, then the tabs in order. The open one is renamed in
// place, moved up or down, or removed; `+` adds one. Every edit is panelTabs.ts, this only asks.

import { ChevronDown, ChevronUp, Plus, Trash2 } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { askConfirm } from "@studio/project-shell/ask";
import { TAB_NAME_MAX } from "@studio/song-schema/yaml/moduleSchema";
import { useEffect, useState } from "react";
import type { ModuleUI } from "./moduleUi";
import {
  addTab,
  moveTab,
  type PageRef,
  removeTab,
  renameTab,
} from "./panelTabs";

export function TabsColumn({
  ui,
  at,
  disabled,
  onSelect,
  onChange,
}: {
  ui: ModuleUI;
  /** The map the grid is writing: a tab by position, or `null` for the widgets every tab shows. */
  at: PageRef;
  disabled?: boolean;
  onSelect: (at: PageRef) => void;
  /** The panel after a tab edit, and the tab the grid should then be on. */
  onChange: (ui: ModuleUI, at: PageRef) => void;
}) {
  const tabs = ui.tabs ?? [];
  // The rename field holds what is TYPED; a name refused (empty, taken) springs back on blur.
  const [draft, setDraft] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the open tab is the trigger, not an input.
  useEffect(() => setDraft(null), [at]);

  const add = () => {
    const next = addTab(ui);
    onChange(next.ui, next.at);
  };
  const remove = async (i: number) => {
    const n = Object.keys(tabs[i].widgets).length;
    if (n) {
      const agreed = await askConfirm({
        title: `Remove the "${tabs[i].name}" tab?`,
        body: `Its ${n} widget${n > 1 ? "s go" : " goes"} with it. Ctrl+Z in the code brings it back.`,
        confirmLabel: "Remove",
        danger: true,
      });
      if (!agreed) return;
    }
    const next = removeTab(ui, i);
    onChange(next, next.tabs?.length ? Math.max(0, i - 1) : null);
  };
  const move = (i: number, by: -1 | 1) => {
    const next = moveTab(ui, i, by);
    onChange(next.ui, next.at);
  };
  const commit = (i: number) => {
    if (draft !== null) onChange(renameTab(ui, i, draft), i);
    setDraft(null);
  };

  return (
    <div className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-border p-1 text-xs">
      {tabs.length > 0 && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          title="Widgets drawn on every tab"
          className={cn(
            "rounded px-2 py-1 text-left italic",
            at === null
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Every tab
        </button>
      )}
      {tabs.map((t, i) =>
        i === at ? (
          <div key={t.name} className="space-y-0.5 rounded bg-secondary p-1">
            <input
              className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary"
              value={draft ?? t.name}
              maxLength={TAB_NAME_MAX}
              disabled={disabled}
              title={`The tab's name — at most ${TAB_NAME_MAX} characters`}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(i);
                if (e.key === "Escape") setDraft(null);
              }}
            />
            <div className="flex items-center gap-0.5">
              <IconBtn
                title="Move up"
                disabled={disabled || i === 0}
                onClick={() => move(i, -1)}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                title="Move down"
                disabled={disabled || i === tabs.length - 1}
                onClick={() => move(i, 1)}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                title="Remove this tab"
                disabled={disabled}
                onClick={() => void remove(i)}
              >
                <Trash2 className="ml-auto h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </div>
        ) : (
          <button
            key={t.name}
            type="button"
            onClick={() => onSelect(i)}
            className="truncate rounded px-2 py-1 text-left text-muted-foreground hover:text-foreground"
          >
            {t.name}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={add}
        disabled={disabled}
        title={
          tabs.length
            ? "Add a tab"
            : "Split the panel into tabs — what is on it becomes the first one"
        }
        className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-left text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> {tabs.length ? "Tab" : "Add tabs"}
      </button>
    </div>
  );
}

function IconBtn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}
