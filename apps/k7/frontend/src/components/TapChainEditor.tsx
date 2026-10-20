// TapChainEditor.tsx — the popin on ONE tap's own chain of effects: its modules in order, each moved or removed
// from here, a module added at the end — the first one making the chain and routing the tap — and the cards
// themselves below, edited as on the graph. Every change is a `node tap chain` command. See docs/shell.md.

import { Button } from "@frediverse/ui/button";
import { ArrowDown, ArrowUp, Plus, X } from "@frediverse/ui/icons";
import { moduleDisplayName } from "@studio/ui-chains/graph";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import { usePopin } from "../popins";
import { useReloadKey, useVerbs } from "../state/shellStore";
import type { WebGraph } from "../types";

/** The tap's subchain as the graph has it: its first node's run, or nothing while the tap is not routed. */
function tapChainOf(
  graph: WebGraph | null,
  node: string,
  tap: string,
): { modules: string[]; labels: Record<string, string> } {
  const feed = graph?.tapFeeds?.find((f) => f.node === node && f.tap === tap);
  const run = feed ? graph?.chains[feed.to] : undefined;
  const steps = run?.use ?? [];
  return {
    modules: steps.map((s) => s.module),
    labels: Object.fromEntries(
      steps.map((s) => [s.module, moduleDisplayName(s.uses ?? s.module)]),
    ),
  };
}

export function TapChainEditor({
  node,
  tap,
  onAddModule,
  renderCards,
  onClose,
}: {
  node: string;
  tap: string;
  /** Opens the module picker at the click; its pick comes back as `node tap chain add`. */
  onAddModule: (x: number, y: number) => void;
  /** The cards of these nodes, editable as on the graph — the shell's, since it holds their stores. */
  renderCards: (nodes: string[]) => React.ReactNode;
  onClose: () => void;
}) {
  const reloadKey = useReloadKey();
  // Every edit here is a command, run through the shell.
  const { runCommand: command } = useVerbs();
  usePopin(true, onClose);
  const [graph, setGraph] = useState<WebGraph | null>(null);
  useEffect(() => {
    void api
      .graph()
      .then(setGraph)
      .catch(() => setGraph(null));
  }, [reloadKey]);
  const { modules, labels } = useMemo(
    () => tapChainOf(graph, node, tap),
    [graph, node, tap],
  );
  const at = `${JSON.stringify(node)} ${JSON.stringify(tap)}`;

  return (
    // Hand-rolled and UNDER the pickers (z-40 to their z-50): a modal dialog would block the picker it opens (docs/shell.md).
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <button
        type="button"
        aria-label={m["common.closeLower"]()}
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={m["tapChain.title"]({ tap, node })}
        className="relative flex max-h-[90vh] w-[min(64rem,94vw)] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-background p-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">
            {m["tapChain.title"]({ tap, node })}
          </h2>
          <Button
            size="icon"
            variant="ghost"
            aria-label={m["common.closeLower"]()}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {modules.length ? m["tapChain.routed"]() : m["tapChain.empty"]()}
        </p>
        <ol className="flex flex-col gap-1">
          {modules.map((id, i) => (
            <li
              key={id}
              className="flex items-center gap-2 rounded border border-border px-2 py-1 text-sm"
            >
              <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <span className="flex-1 truncate">{labels[id]}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={m["tapChain.up"]()}
                disabled={i === 0}
                onClick={() =>
                  void command(`node tap chain move ${at} ${id} up`)
                }
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={m["tapChain.down"]()}
                disabled={i === modules.length - 1}
                onClick={() =>
                  void command(`node tap chain move ${at} ${id} down`)
                }
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={m["tapChain.remove"]()}
                onClick={() =>
                  void command(`node tap chain remove ${at} ${id}`)
                }
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ol>
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => onAddModule(e.clientX, e.clientY)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {m["tapChain.add"]()}
          </Button>
        </div>
        {/* The modules themselves, knobs and all: the same cards the graph draws, on the same stores. */}
        {modules.length > 0 && (
          <div className="h-64 min-h-0 overflow-hidden rounded border border-border">
            {renderCards(modules)}
          </div>
        )}
      </div>
    </div>
  );
}
