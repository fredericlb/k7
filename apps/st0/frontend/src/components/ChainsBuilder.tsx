// ChainsBuilder.tsx — the library's chains, edited as what they are: graphs. The list on the
// left, the chosen one drawn on the right by the same buildGraph → layout → DomChains pipeline
// the project's own graph uses, with the same gestures. See docs/chainsBuilder.md.

import { cn } from "@frediverse/ui/lib/utils";
import { projectApi } from "@studio/project-shell/project";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { buildGraph, layout } from "@studio/ui-chains/graph";
import { DomChains } from "@studio/ui-chains-react";
import { useAutosave } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import { Loader2, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STUDIO_ICONS } from "../chainsIcons";
import type { WebGraph } from "../types";

interface LibraryChain {
  ref: string;
  path: string;
  /** The node files beside the graph, by name — the other half of what a chain IS. */
  nodes: string[];
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
  onClose,
  vimMode,
  onLog,
  focusNode,
}: {
  open: string;
  /** A node file of that chain to land on — the tree row that was clicked. The editor opens on
   *  it and the graph selects it, so one click answers "show me this node" in both halves. */
  focusNode?: string | null;
  /** The shell's editing mode, passed through so this pane behaves like every other one. */
  vimMode: boolean;
  /** Report a command (or its failure) into the shell's log — the same sink App's own commands
   *  use, so one transcript holds everything that ran whatever it was aimed at. */
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
      // Reported to the shell's transcript, WITH where it was aimed. These verbs run against a
      // library chain and not the open song, so a bare line in the log would claim an edit to
      // the project that never happened — and the log's promise is every command, not every
      // command that touched the song.
      onLog?.("cmd", `› [${chosen.ref}] ${line}`);
      try {
        // `want: []` because the graph this pane draws is the CHAIN's, fetched by `graphAt` on
        // the `rev` below — never the open song's, which is the only one the route would build.
        await projectApi.command(line, { at: chosen.path, want: [] });
        setRev((r) => r + 1);
      } catch (e) {
        setError((e as Error).message);
        onLog?.("error", `[${chosen.ref}] ${(e as Error).message}`);
      }
    },
    [chosen, onLog],
  );

  /** The node id the drawing selects: the focused file without its extension, or none. */
  const selectedNode = useMemo(
    () => (focusNode ? focusNode.replace(/.ya?ml$/i, "") : null),
    [focusNode],
  );

  const drawn = useMemo(() => {
    if (!graph) return null;
    const { nodes, edges } = buildGraph(graph);
    return layout(nodes, edges);
  }, [graph]);

  // --- the text half -----------------------------------------------------------------
  // A chain is two things on disk — the graph file and the nodes it names — and the gestures
  // above reach only the first. Params, `extends`, everything a node IS, is text; without it the
  // screen draws a chain nobody can change.
  const files = useMemo(
    () =>
      chosen
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
  // The tree asked for a node: open its tab. An effect and not an initial value, because the
  // screen stays mounted — clicking a second node must move the pane, not be ignored.
  useEffect(() => {
    if (chosen && focusNode) setOpenFile(`${chosen.path}/nodes/${focusNode}`);
  }, [chosen, focusNode]);
  const [text, setText] = useState("");
  // What was last read or saved, so the pane knows whether it is dirty without a second state.
  const [saved, setSaved] = useState("");

  // The chosen file, re-read whenever a verb changed the chain — a `graph move` rewrites the
  // graph file under the pane showing it.
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
        setText(f.content ?? "");
        setSaved(f.content ?? "");
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
  // The same autosave every text pane in this repo runs — no Save button, written as soon as it
  // is a file the compiler could read. See @studio/ui-editor's docs/autosave.md.
  const autosave = useAutosave({ path, text, saved, write });

  return (
    <div className="absolute inset-0 z-10 flex bg-background">
      {/* No chain LIST here: the Libraries tab of the file tree is the navigation, and a
          second list of the same rows would be two places to look for one thing. What stays is
          the name of what is open and the way out. */}
      <header className="absolute right-2 top-2 z-20 flex items-center gap-2 rounded border bg-background px-2 py-1">
        <Workflow className="size-3.5" />
        <span className="text-xs font-medium">{open || "—"}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:underline"
        >
          fermer
        </button>
      </header>

      {/* The text half, LEFT of the drawing: what you type is what the graph is made of, so it
          reads first. The two are one chain seen twice, and a change in either shows in the other
          on the next read. */}
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
            <button
              type="button"
              // `node new` writes into the chain's own `nodes/`, because the verb resolves that
              // folder from the graph file it was pointed at — the same `at` every gesture uses.
              onClick={() => {
                const name = window.prompt(
                  "Nouveau nœud — <type>/<module> <nom>",
                );
                if (name?.trim()) void command(`node new ${name.trim()}`);
              }}
              className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
            >
              + nœud
            </button>
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
          <p className="shrink-0 border-t px-2 py-1 text-[11px] text-muted-foreground">
            {text === saved ? "enregistré" : "…"}
          </p>
        </aside>
      ) : null}
      <section className="relative min-w-0 flex-1 basis-0">
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
            // The node the tree asked for, selected in the drawing — the same click answers in
            // both halves. The graph names a node by its FILE's basename, which is what a chain
            // graph writes in its segments.
            selected={selectedNode}
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
