// usePendingBypass.ts — a bypass clicked but not yet in the graph, painted on after layout. A bypass
// bumps no reloadKey, which is all the graph panel and the track's module row refetch on, so without
// this the click would show nothing until the next unrelated reload (docs/shell.md).

import type { LaidOutGraph } from "@studio/ui-chains/graph";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/** The bypass toggle to hand the graph, and the layout with the clicks not yet read back painted on. */
export function usePendingBypass<L extends LaidOutGraph>(
  laid: L | null,
  laidRef: RefObject<L | null>,
  graph: unknown,
  onBypassModule?: (module: string) => void,
): { bypassModule: (module: string) => void; laidShown: L | null } {
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // A fresh graph carries the bypass itself: what was pending is now read back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the graph's identity IS the trigger.
  useEffect(() => setPending({}), [graph]);

  const bypassModule = useCallback(
    (module: string) => {
      setPending((prev) => {
        const node = laidRef.current?.nodes.find(
          (n) => n.kind === "module" && n.module === module,
        );
        const now = prev[module] ?? !!node?.bypassed;
        return { ...prev, [module]: !now };
      });
      onBypassModule?.(module);
    },
    [laidRef, onBypassModule],
  );

  // It changes how a node READS, never where it sits.
  const laidShown = useMemo(() => {
    if (!laid || !Object.keys(pending).length) return laid;
    return {
      ...laid,
      nodes: laid.nodes.map((n) => {
        if (n.kind !== "module" || !n.module) return n;
        const b = pending[n.module];
        return b === undefined ? n : { ...n, bypassed: b, dim: b };
      }),
    };
  }, [laid, pending]);

  return { bypassModule, laidShown };
}
