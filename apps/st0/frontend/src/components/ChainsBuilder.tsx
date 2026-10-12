// ChainsBuilder.tsx — the library's chains, edited as what they are: graphs. The text on the left,
// the chosen one drawn on the right by the same buildGraph → layout → DomChains pipeline the
// project's own graph uses — with its gestures for a folder chain, read-only for a chain file,
// which the server's verbs do not reach yet. See docs/chainsBuilder.md.

import { Loader2, Workflow, X } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { askText } from "@studio/project-shell/ask";
import { projectApi } from "@studio/project-shell/project";
import { DEFAULT_LIBRARY, libraryRef } from "@studio/song-schema/moduleTypes";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { buildGraph, layout } from "@studio/ui-chains/graph";
import { DomChains } from "@studio/ui-chains-react";
import { useAutosave } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STUDIO_ICONS } from "../chainsIcons";
import { isChainFile } from "../libraryTree";
import { m } from "../paraglide/messages.js";
import { needsAttention, saveLabel } from "../saveLabel";
import { templateGraph } from "../templateGraph";
import type { WebGraph } from "../types";

interface LibraryChain {
  ref: string;
  /** The chain's file, or a folder chain's folder. */
  path: string;
  /** A folder chain's node files beside its graph; a chain file holds its nodes, so none. */
  nodes: string[];
}

/** The builder — `open` is the chain's ref, `""` the list; every verb carries the chain's PATH, so it writes the template and never the song. */
export function ChainsBuilder({
  open,
  onClose,
  vimMode,
  onLog,
  focusNode,
}: {
  open: string;
  /** A node file of that chain to land on — the editor opens on it and the graph selects it, so one click answers both halves. */
  focusNode?: string | null;
  /** The shell's editing mode, passed through so this pane behaves like every other one. */
  vimMode: boolean;
  /** Report a command (or its failure) into the shell's log — the same sink App's own commands use. */
  onLog?: (kind: "cmd" | "error", text: string) => void;
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

  // A BARE ref is the default library's: a URL written before libraries had names still opens its chain.
  const chosen = useMemo(
    () =>
      chains?.find(
        (c) => c.ref === open || c.ref === libraryRef(DEFAULT_LIBRARY, open),
      ) ?? null,
    [chains, open],
  );

  // A chain FILE is drawn from its own text in the browser; only a folder chain has a graph the server builds.
  const isFile = !!chosen && isChainFile(chosen.path);

  // The chain's own graph, asked for by path; null while it loads and when nothing is chosen — the drawing waits, not the list.
  useEffect(() => {
    if (!chosen || isFile) {
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
  }, [chosen, isFile, rev]);

  /** Run a verb ON THE CHAIN — every gesture goes through this, so one place knows the edit is aimed somewhere other than the song. */
  const command = useCallback(
    async (line: string) => {
      if (!chosen) return;
      // No verb reaches a chain file yet: said rather than run against nothing.
      if (isFile) {
        onLog?.(
          "error",
          `[${chosen.ref}] a chain file is edited as text — "${line}" reaches folder chains only`,
        );
        return;
      }
      // Reported to the shell's transcript WITH where it was aimed: a bare line would claim an edit to the project that never happened.
      onLog?.("cmd", `› [${chosen.ref}] ${line}`);
      try {
        // `want: []` because the graph this pane draws is the CHAIN's, fetched by `graphAt` on the `rev` below.
        await projectApi.command(line, { at: chosen.path, want: [] });
        // A verb that worked answers the one that failed before it, which would otherwise sit over the drawing all session.
        setError(null);
        setRev((r) => r + 1);
      } catch (e) {
        setError((e as Error).message);
        onLog?.("error", `[${chosen.ref}] ${(e as Error).message}`);
      }
    },
    [chosen, isFile, onLog],
  );

  /** The node id the drawing selects: the focused file without its extension, or none. */
  const selectedNode = useMemo(
    () => (focusNode ? focusNode.replace(/.ya?ml$/i, "") : null),
    [focusNode],
  );

  // --- the text half -----------------------------------------------------------------

  // A folder chain is two things on disk, and the gestures reach only the first: params and `extends` are text.
  const files = useMemo(
    () =>
      chosen && isChainFile(chosen.path)
        ? [
            {
              label: chosen.path.split("/").pop() ?? chosen.path,
              path: chosen.path,
            },
          ]
        : chosen
          ? [
              { label: GRAPH_FILE, path: `${chosen.path}/${GRAPH_FILE}` },
              ...chosen.nodes.map((n) => ({
                label: `nodes/${n}`,
                path: `${chosen.path}/nodes/${n}`,
              })),
            ]
          : [],
    [chosen],
  );
  const [openFile, setOpenFile] = useState<string | null>(null);
  // The tree asked for a node: open its tab — an effect, since the screen stays mounted and a second click must move the pane.
  useEffect(() => {
    if (chosen && focusNode && !isChainFile(chosen.path))
      setOpenFile(`${chosen.path}/nodes/${focusNode}`);
  }, [chosen, focusNode]);
  const [text, setText] = useState("");
  // What was last read or saved, so the pane knows whether it is dirty without a second state.
  const [saved, setSaved] = useState("");

  // The buffer as last rendered, read by the re-read below without making it a dependency.
  const buf = useRef({ path: null as string | null, text, saved });
  buf.current = { path: openFile ?? files[0]?.path ?? null, text, saved };

  // The chosen file, re-read whenever a verb changed the chain — a `graph move` rewrites the file under the pane showing it.
  useEffect(() => {
    const path = openFile ?? files[0]?.path;
    if (!path) {
      setText("");
      setSaved("");
      return;
    }
    let live = true;
    projectApi
      .read(path)
      .then((f) => {
        if (!live) return;
        const fresh = f.content ?? "";
        const b = buf.current;
        // Typing not yet saved on this same file wins over the re-read: the autosave writes it next, the person's text intact.
        if (b.path === path && b.text !== b.saved) return;
        setText(fresh);
        setSaved(fresh);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [openFile, files, rev]);

  const path = openFile ?? files[0]?.path ?? null;
  const write = useCallback(
    async (next: string) => {
      if (!path) return;
      await projectApi.write(path, next);
      setSaved(next);
      // The drawing follows the text: editing a node's `extends` changes what the graph shows.
      setRev((r) => r + 1);
    },
    [path],
  );
  // The same autosave every text pane in this repo runs — see @studio/ui-editor's docs/autosave.md.
  const autosave = useAutosave({ path, text, saved, write });

  // A chain file's drawing follows what was last SAVED, as a folder chain's follows its re-read graph.
  const fileGraph = useMemo(
    () => (chosen && isFile ? templateGraph(chosen.ref, saved) : null),
    [chosen, isFile, saved],
  );
  const shown = fileGraph
    ? "graph" in fileGraph
      ? fileGraph.graph
      : null
    : graph;
  const drawn = useMemo(() => {
    if (!shown) return null;
    const { nodes, edges } = buildGraph(shown);
    return layout(nodes, edges);
  }, [shown]);
  const fileError = fileGraph && "error" in fileGraph ? fileGraph.error : null;

  return (
    <div className="absolute inset-0 z-10 flex bg-background">
      {/* No chain LIST here: the file tree's Libraries tab is the navigation, and a second list would be two places to look. */}
      <header className="absolute right-2 top-2 z-20 flex items-center gap-2 rounded border bg-background px-2 py-1">
        <Workflow className="size-3.5" />
        <span className="text-xs font-medium">{open || "—"}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:underline"
        >
          {m["common.closeLower"]()}
        </button>
      </header>

      {/* The text half, LEFT of the drawing: what you type is what the graph is made of, and the two are one chain seen twice. */}
      {open && chosen ? (
        <aside className="flex min-w-0 flex-1 basis-0 flex-col border-r">
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
            {files.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => setOpenFile(f.path)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] hover:bg-muted",
                  (openFile ?? files[0]?.path) === f.path &&
                    "bg-muted font-medium",
                )}
              >
                {f.label}
              </button>
            ))}
            {isFile ? null : (
              <button
                type="button"
                // `node new` writes into the chain's own `nodes/`, the verb resolving that folder from the graph file it was pointed at.
                onClick={() => {
                  void askText({
                    title: m["cb.newNodeTitle"](),
                    body: m["cb.newNodeBody"](),
                    placeholder: "<type>/<module> <nom>",
                    confirmLabel: m["common.create"](),
                    // The line becomes `node new <this>`, so a quote here would become extra arguments there.
                    validate: (v) =>
                      !v.trim()
                        ? m["cb.nodeNamesModule"]()
                        : /["']/.test(v)
                          ? m["cb.noQuotes"]()
                          : !/^\S+\/\S+/.test(v.trim())
                            ? m["cb.moduleShape"]()
                            : "",
                  }).then((name) => {
                    if (name?.trim()) void command(`node new ${name.trim()}`);
                  });
                }}
                className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
              >
                + nœud
              </button>
            )}
          </div>
          <div className="min-h-0 min-w-0 flex-1">
            {path ? (
              <YamlPane
                path={path}
                content={text}
                vimMode={vimMode}
                onChange={setText}
                onSave={autosave.flush}
              />
            ) : null}
          </div>
          {/* The same sentence every other text pane says: an ellipsis cannot report a write being HELD. */}
          <p
            className={cn(
              "shrink-0 truncate border-t px-2 py-1 text-[11px]",
              needsAttention(autosave.status)
                ? "text-amber-500"
                : "text-muted-foreground",
            )}
            title={autosave.reason ?? undefined}
          >
            {saveLabel(autosave.status, autosave.reason)}
          </p>
        </aside>
      ) : null}
      <section className="relative min-w-0 flex-1 basis-0">
        {(error ?? fileError) && (
          <div
            role="alert"
            className="absolute inset-x-0 top-0 z-10 flex items-start gap-2 bg-destructive/10 p-2 text-xs"
          >
            <p className="min-w-0 flex-1">{error ?? fileError}</p>
            {/* It covers the top of the drawing, so it has to be closable without running another verb. */}
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label={m["common.closeLower"]()}
              title={m["common.closeLower"]()}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {!open ? (
          <p className="grid h-full place-items-center text-sm text-muted-foreground">
            {m["cb.pickChain"]()}
          </p>
        ) : !drawn ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DomChains
            icons={STUDIO_ICONS}
            graph={drawn}
            // The node the tree asked for, selected in the drawing — the graph names a node by its FILE's basename.
            selected={selectedNode}
            onSelect={() => {}}
            command={command}
            // The patch cable, the splice and the pin — the same three the project's graph wires, pointed at the template.
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
