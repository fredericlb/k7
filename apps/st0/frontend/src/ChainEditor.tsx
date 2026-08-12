// ChainEditor.tsx — a chain TEMPLATE: its chains.yaml on the left, the routing it declares
// drawn on the right. Minimal on purpose — the segments are edited as text, as they are in
// l8; what this adds is seeing the shape while you type it. See docs/chains.md.

import { Button } from "@frediverse/ui/button";
import type { MediatekEntry } from "@studio/mediatek/types";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import {
  BENCH_REPO,
  benchProjectForChain,
  launchUrl,
} from "@studio/web-protocol/projects";
import { ArrowLeft, ExternalLink, Loader2, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { library } from "./api";
import { ChainView } from "./ChainView";
import { chainNodes, chainsVocabulary } from "./chainsVocabulary";
import { SaveState } from "./SaveState";

/** The file that IS the chain — the same name and shape a l8 project uses at its root. */
const CHAINS_FILE = "chains.yaml";

export function ChainEditor({
  entry,
  vimMode,
  onBack,
  onSaved,
}: {
  entry: MediatekEntry;
  vimMode: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
  const path = `${entry.path}/${CHAINS_FILE}`;
  // `meta` is deliberately loose (a listing is family-agnostic), so the count is narrowed here.
  // `nodeCount`, not `nodes`: the list of names the segments may point at is below, and it is
  // the one this file calls `nodes`.
  const nodeCount = Number(entry.meta?.nodes ?? 0);
  const [content, setContent] = useState<string | null>(null);
  // What is on disk. Dirty is `content !== saved`, derived rather than a flag a failed write
  // could leave lying — the same rule the other editors keep.
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let alive = true;
    setContent(null);
    void library
      .readFile(path)
      .then((f) => {
        if (!alive) return;
        // An edit that could not be written outlived this screen — give it back, not disk.
        setContent(recallBuffer(path) ?? f.content);
        setSaved(f.content);
      })
      .catch((e: Error) => alive && setStatus(e.message));
    return () => {
      alive = false;
    };
  }, [path]);

  /**
   * The nodes a segment may point at, as the text CURRENTLY declares them.
   *
   * Only ever REPLACED by something readable, exactly as the drawing on the right is: the
   * document stops parsing on nearly every keystroke — a bracket you have not typed yet — and
   * a list that emptied itself each time would offer nothing precisely while you are writing
   * the line that needs it.
   */
  const [nodes, setNodes] = useState<string[] | null>(null);
  useEffect(() => {
    if (content == null) return;
    const read = chainNodes(content);
    if (read) setNodes(read);
  }, [content]);
  const vocabulary = useMemo(
    () => chainsVocabulary(path, nodes),
    [path, nodes],
  );

  // No Save button: written as soon as it is a chains file the compiler could read.
  const write = useCallback(
    async (next: string) => {
      await library.writeFile(path, next);
      setSaved(next);
      setStatus(`enregistré ${path}`);
      onSaved();
    },
    [path, onSaved],
  );
  const autosave = useAutosave({
    path: content == null ? null : path,
    text: content ?? "",
    saved,
    write,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Retour
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2 truncate text-sm font-semibold">
            <Workflow className="h-4 w-4" /> Chaîne · {entry.name}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {path}
          </div>
        </div>
        <SaveState autosave={autosave} className="ml-auto shrink-0" />
        {/* The same argument the module screen makes, and the same bench: a chain is a routing
            you HEAR, so editing it against nothing was always half the job. l8 opens it with
            the médiathèque's modules in reach and writes back here when you save. */}
        <a
          className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          href={launchUrl(
            window.location.origin,
            BENCH_REPO,
            benchProjectForChain(entry.path),
            "l8",
          )}
          target="_blank"
          rel="noopener"
        >
          <ExternalLink className="h-4 w-4" />
          Ouvrir sur le banc
        </a>
      </header>

      {content == null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> chargement…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Côte à côte dès qu'il y a la place, EMPILÉ sinon : deux moitiés d'un
              écran de téléphone font deux colonnes où rien ne tient. */}
          <div className="min-h-0 shrink-0 border-b border-border md:h-auto md:w-1/2 md:border-r md:border-b-0 h-1/2">
            <YamlPane
              path={path}
              content={content}
              // The file's SECTIONS come from the schema, but its nodes are named by the
              // template itself — there is no project here to hint them. See
              // ./chainsVocabulary.ts.
              vocabulary={vocabulary}
              vimMode={vimMode}
              onChange={setContent}
              onSave={autosave.flush}
            />
          </div>
          <div className="min-h-0 min-w-0 flex-1">
            <ChainView text={content} />
          </div>
        </div>
      )}

      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        <span>
          {nodeCount} node{nodeCount > 1 ? "s" : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-right">{status}</span>
      </footer>
    </div>
  );
}
