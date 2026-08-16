// ChainsBuilder.tsx — the library's chains, edited as what they are: graphs. The list on the
// left, the chosen one drawn on the right by the same buildGraph → layout → DomChains pipeline
// the project's own graph uses, with the same gestures. See docs/chainsBuilder.md.

import { cn } from "@frediverse/ui/lib/utils";
import { projectApi } from "@studio/project-shell/project";
import { buildGraph, layout } from "@studio/ui-chains/graph";
import { DomChains } from "@studio/ui-chains-react";
import { Loader2, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STUDIO_ICONS } from "../chainsIcons";
import type { WebGraph } from "../types";

interface LibraryChain {
  ref: string;
  path: string;
}

/**
 * The builder.
 *
 * `open` is the chain's ref, or `""` for the list with nothing chosen — a real state, and the
 * address `/chains-builder` parses to.
 *
 * It talks to the file service directly rather than through the shell's `runCommand`, and that is
 * the point of the whole screen: every verb carries the chain's PATH, so `graph chain connect`
 * writes the template's `chains.yaml` and never the open song's `graph.yaml`. What makes that
 * work with no second editor is that the two are the same document under two names — see
 * @studio/song's `graphFileOf`.
 */
export function ChainsBuilder({
  open,
  onOpen,
  onClose,
}: {
  open: string;
  onOpen: (ref: string) => void;
  onClose: () => void;
}) {
  const [chains, setChains] = useState<LibraryChain[] | null>(null);
  const [graph, setGraph] = useState<WebGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by every write, so the drawing re-reads the file the verb just changed.
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let live = true;
    projectApi
      .libraryChains()
      .then((r) => live && setChains(r.chains))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  const chosen = useMemo(
    () => chains?.find((c) => c.ref === open) ?? null,
    [chains, open],
  );

  // The chain's own graph, asked for by path. Null while it loads and when nothing is chosen —
  // the drawing is what waits, not the list beside it.
  useEffect(() => {
    if (!chosen) {
      setGraph(null);
      return;
    }
    let live = true;
    setError(null);
    projectApi
      .graphAt(chosen.path)
      .then((g) => live && setGraph(g))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [chosen, rev]);

  /**
   * Run a verb ON THE CHAIN. Every gesture below goes through this and nothing else, so there is
   * one place that knows the edit is aimed somewhere other than the song.
   */
  const command = useCallback(
    async (line: string) => {
      if (!chosen) return;
      try {
        await projectApi.command(line, chosen.path);
        setRev((r) => r + 1);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [chosen],
  );

  const drawn = useMemo(() => {
    if (!graph) return null;
    const { nodes, edges } = buildGraph(graph);
    return layout(nodes, edges);
  }, [graph]);

  return (
    <div className="absolute inset-0 z-40 flex bg-background">
      <aside className="w-64 shrink-0 overflow-auto border-r">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Workflow className="size-4" />
          <span className="text-sm font-medium">Chains</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-xs text-muted-foreground hover:underline"
          >
            fermer
          </button>
        </header>
        {chains === null ? (
          <p className="p-3 text-xs text-muted-foreground">…</p>
        ) : chains.length === 0 ? (
          // Not an error: an account whose library has no chains yet is a fact, and the sentence
          // says where they would come from rather than that something failed.
          <p className="p-3 text-xs text-muted-foreground">
            Aucune chaîne dans la bibliothèque de ce compte.
          </p>
        ) : (
          <ul>
            {chains.map((c) => (
              <li key={c.ref}>
                <button
                  type="button"
                  onClick={() => onOpen(c.ref)}
                  className={cn(
                    "w-full px-3 py-1.5 text-left text-xs hover:bg-muted",
                    c.ref === open && "bg-muted font-medium",
                  )}
                >
                  {c.ref}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="relative min-w-0 flex-1">
        {error && (
          <p className="absolute inset-x-0 top-0 z-10 bg-destructive/10 p-2 text-xs">
            {error}
          </p>
        )}
        {!open ? (
          <p className="grid h-full place-items-center text-sm text-muted-foreground">
            Choisissez une chaîne.
          </p>
        ) : !drawn ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DomChains
            icons={STUDIO_ICONS}
            graph={drawn}
            selected={null}
            onSelect={() => {}}
            command={command}
            // The patch cable, the splice and the pin — the same three the project's graph wires,
            // pointed at the template. A chain with no gestures would be a picture of one.
            onConnect={(from, to) =>
              void command(`graph chain connect ${from} ${to}`)
            }
            onDisconnect={(from, to) =>
              void command(`graph chain disconnect ${from} ${to}`)
            }
            onReplug={(from, to, nf, nt) =>
              void command(`graph chain replug ${from} ${to} ${nf} ${nt}`)
            }
            onMoveNode={(mod, x, y) =>
              void command(`graph move ${mod} ${x} ${y}`)
            }
          />
        )}
      </section>
    </div>
  );
}
