// PresetPicker.tsx — "which preset?", asked by a node's one dropdown on the graph. The same popup as
// the module and asset pickers, with a header of its own — SAVE the node as a new preset, kept in the
// workspace or a library, and UPDATE the one last loaded — and, for a module with several engines, a
// left bar to pick the ENGINE. Every action is a verb the caller runs. See packages/song/docs/userPresets.md.

import { RefreshCw, Save } from "@frediverse/ui/icons";
import {
  type NodePresets,
  PRESET_NAME,
  type PresetEntry,
} from "@studio/song-schema/presets";
import type { NodeEngines } from "@studio/ui-chains-react";
import { useState } from "react";
import { fuzzyScore } from "../fuzzy";
import { m } from "../paraglide/messages.js";
import { type TreeNode, TreePicker } from "./TreePicker";

const SEARCH_LIMIT = 40;

const keyOf = (p: PresetEntry) => `${p.scope}:${p.name}`;

/** The presets as one level, the scope as each row's hint — a branch per scope would hide the few there are. */
function presetTree(presets: PresetEntry[]): TreeNode<PresetEntry>[] {
  return presets.map((p) => ({
    key: keyOf(p),
    label: p.name,
    entry: p,
    hint: p.scope,
  }));
}

/** Flat matches for a query, best first. */
function searchPresets(
  presets: PresetEntry[],
  query: string,
): TreeNode<PresetEntry>[] {
  const q = query.trim();
  if (!q) return [];
  return presets
    .map((p) => ({ p, score: fuzzyScore(q, p.name) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, SEARCH_LIMIT)
    .map(({ p }) => ({
      key: keyOf(p),
      label: p.name,
      entry: p,
      hint: p.scope,
    }));
}

const BTN =
  "inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-40";

export function PresetPicker({
  x,
  y,
  node,
  data,
  current,
  onApply,
  onSave,
  onUpdate,
  engines,
  onEngine,
  onClose,
}: {
  x: number;
  y: number;
  node: string;
  data: NodePresets;
  /** The preset last loaded on this node, which the header offers to overwrite. */
  current?: PresetEntry;
  onApply: (p: PresetEntry) => void;
  onSave: (name: string, scope: string) => void;
  onUpdate: (p: PresetEntry) => void;
  /** The engines the node runs as, when there is a choice: the left bar. */
  engines?: NodeEngines;
  onEngine?: (name: string) => void;
  onClose: () => void;
}) {
  // The engine asked for, lit at once: the popup stays open, so a preset can be picked for it next.
  const [engine, setEngine] = useState(engines?.current);
  const [name, setName] = useState("");
  const [scope, setScope] = useState(data.scopes[0] ?? "workspace");
  const clean = name.trim();
  const taken = data.presets.some((p) => p.scope === scope && p.name === clean);
  const canSave = PRESET_NAME.test(clean) && !taken;
  const save = () => {
    if (!canSave) return;
    onSave(clean, scope);
    onClose();
  };
  // Only a preset this node's module still lists can be overwritten — one from before a rename is not offered.
  const updatable =
    current &&
    data.presets.some(
      (p) => p.scope === current.scope && p.name === current.name,
    )
      ? current
      : undefined;

  // A module with no presets at all (a self-contained one) still opens for its engines, without the save row.
  const header = !data.scopes.length ? undefined : (
    <div className="flex flex-col gap-1 pb-1 pt-0.5">
      <div className="flex items-center gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          placeholder={`save ${node} as…`}
          title={taken ? `'${clean}' is already kept in ${scope}` : undefined}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-1 py-0.5 font-mono text-xs outline-none focus:border-primary placeholder:text-muted-foreground/60"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          title={m["preset.scopeHint"]()}
          className="rounded border border-border bg-popover px-0.5 py-0.5 font-mono text-xs"
        >
          {data.scopes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={BTN}
          disabled={!canSave}
          onClick={save}
        >
          <Save className="h-3 w-3" /> Save
        </button>
      </div>
      {updatable && (
        <button
          type="button"
          className={`${BTN} justify-start`}
          title={`overwrite ${updatable.scope}:${updatable.name} with ${node}'s current values`}
          onClick={() => {
            onUpdate(updatable);
            onClose();
          }}
        >
          <RefreshCw className="h-3 w-3" /> Update{" "}
          <span className="truncate font-mono">{updatable.name}</span>
        </button>
      )}
    </div>
  );

  const aside = engines && (
    <div
      className="mr-1 flex max-h-[min(28rem,80vh)] flex-col overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
      role="menu"
      aria-label={m["preset.engine"]()}
    >
      <div className="px-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {m["preset.engine"]()}
      </div>
      {engines.names.map((name) => (
        <button
          key={name}
          type="button"
          role="menuitemradio"
          aria-checked={name === engine}
          onClick={() => {
            if (name === engine) return;
            setEngine(name);
            onEngine?.(name);
          }}
          className={`px-3 py-1 text-left font-mono hover:bg-accent hover:text-accent-foreground ${
            name === engine ? "bg-accent text-accent-foreground" : ""
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );

  return (
    <TreePicker<PresetEntry>
      x={x}
      y={y}
      tree={presetTree(data.presets)}
      search={(q) => searchPresets(data.presets, q)}
      searchLimit={SEARCH_LIMIT}
      placeholder={`search presets of ${data.ref ?? node}…`}
      emptyLabel={data.presets.length ? "no preset matches" : "no presets yet"}
      onPick={onApply}
      onClose={onClose}
      header={header}
      aside={aside}
    />
  );
}
