// useNodePresets.tsx — the graph's one dropdown, host side: fetch a node's presets when it opens, run
// the `node preset` verb a pick or a header button asks for — and `node engine` for its engine bar —
// and remember per node which preset was last loaded. That memory is SESSION state, like an open assembly: a node
// file says what its values are, not which preset they came from. See packages/song/docs/userPresets.md.

import type { NodePresets, PresetEntry } from "@studio/song-schema/presets";
import type { NodeEngines } from "@studio/ui-chains-react";
import { useCallback, useMemo, useState } from "react";
import { api } from "../api";
import { PresetPicker } from "../components/PresetPicker";

const q = (v: string) => JSON.stringify(v);

export function useNodePresets(runCommand: (line: string) => Promise<void>) {
  const [open, setOpen] = useState<{
    node: string;
    x: number;
    y: number;
    data: NodePresets;
    engines?: NodeEngines;
  } | null>(null);
  const [loaded, setLoaded] = useState<Record<string, PresetEntry>>({});

  const openPresets = useCallback(
    (node: string, x: number, y: number, engines?: NodeEngines) => {
      void api
        .nodePresets(node)
        .then((data) => setOpen({ node, x, y, data, engines }))
        // A node with no presets to list still has its engines to offer.
        .catch(() => {
          if (engines)
            setOpen({
              node,
              x,
              y,
              data: { ref: null, presets: [], scopes: [] },
              engines,
            });
        });
    },
    [],
  );

  // A label per node for the dropdown — the name alone, the scope being in the list.
  const presetNames = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(loaded).map(([node, p]) => [node, p.name]),
      ),
    [loaded],
  );

  const remember = useCallback(
    (node: string, p: PresetEntry) => setLoaded((l) => ({ ...l, [node]: p })),
    [],
  );

  const picker = open ? (
    <PresetPicker
      x={open.x}
      y={open.y}
      node={open.node}
      data={open.data}
      current={loaded[open.node]}
      // Remembered at once: the picker only offers a listed preset, and a free, valid name to save under.
      onApply={(p) => {
        remember(open.node, p);
        void runCommand(
          `node preset apply ${q(open.node)} ${q(p.scope)} ${q(p.name)}`,
        );
      }}
      onSave={(name, scope) => {
        remember(open.node, { scope, name });
        void runCommand(
          `node preset save ${q(open.node)} ${q(name)} ${q(scope)}`,
        );
      }}
      onUpdate={(p) =>
        void runCommand(
          `node preset update ${q(open.node)} ${q(p.scope)} ${q(p.name)}`,
        )
      }
      engines={open.engines}
      onEngine={(name) => void runCommand(`node engine ${open.node} ${name}`)}
      onClose={() => setOpen(null)}
    />
  ) : null;

  return { presetNames, openPresets, picker };
}
