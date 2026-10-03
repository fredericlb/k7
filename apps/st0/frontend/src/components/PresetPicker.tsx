// PresetPicker.tsx — "which preset?", asked by a node's preset dropdown on the graph. The same
// popup as the module and asset pickers, with a header of its own: SAVE the node as a new preset,
// kept in the workspace or a library, and UPDATE the one last loaded. Every action is a
// `node preset` verb the caller runs. See packages/song/docs/userPresets.md.

import { RefreshCw, Save } from "@frediverse/ui/icons";
import {
  type NodePresets,
  PRESET_NAME,
  type PresetEntry,
} from "@studio/song-schema/presets";
import { useState } from "react";
import { fuzzyScore } from "../fuzzy";
import { type TreeNode, TreePicker } from "./TreePicker";

const SEARCH_LIMIT = 40;

const keyOf = (p: PresetEntry) => `${p.scope}:${p.name}`;

/** The presets as one level, the scope as each row's hint — a branch per scope would hide the few there are. */
export function presetTree(presets: PresetEntry[]): TreeNode<PresetEntry>[] {
  return presets.map((p) => ({
    key: keyOf(p),
    label: p.name,
    entry: p,
    hint: p.scope,
  }));
}

/** Flat matches for a query, best first. */
export function searchPresets(
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
  onClose: () => void;
}) {
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

  const header = (
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
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-1 py-0.5 font-mono text-xs outline-none placeholder:text-muted-foreground/60"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          title="where the preset is kept"
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
    />
  );
}
