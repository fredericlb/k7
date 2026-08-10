// ChainEditor.tsx — a chain TEMPLATE: its chains.yaml on the left, the routing it declares
// drawn on the right. Minimal on purpose — the segments are edited as text, as they are in
// l8; what this adds is seeing the shape while you type it. See docs/chains.md.

import { Button } from "@frediverse/ui/button";
import type { MediatekEntry } from "@studio/mediatek/types";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import { ArrowLeft, Loader2, Save, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { library } from "./api";
import { ChainView } from "./ChainView";
import { chainNodes, chainsVocabulary } from "./chainsVocabulary";

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
  const instances = Number(entry.meta?.instances ?? 0);
  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let alive = true;
    setContent(null);
    setDirty(false);
    void library
      .readFile(path)
      .then((f) => alive && setContent(f.content))
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

  const save = useCallback(async () => {
    if (content == null) return;
    setSaving(true);
    try {
      await library.writeFile(path, content);
      setDirty(false);
      setStatus(`enregistré ${path}`);
      onSaved();
    } catch (e) {
      setStatus(`erreur : ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [content, path, onSaved]);

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
        <Button
          size="sm"
          className="ml-auto"
          variant={dirty ? "default" : "secondary"}
          disabled={saving || content == null}
          onClick={() => void save()}
        >
          {saving ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1 h-4 w-4" />
          )}
          Enregistrer{dirty ? " *" : ""}
        </Button>
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
              onChange={(text) => {
                setContent(text);
                setDirty(true);
              }}
              onSave={() => void save()}
            />
          </div>
          <div className="min-h-0 min-w-0 flex-1">
            <ChainView text={content} />
          </div>
        </div>
      )}

      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        <span>
          {instances} instance{instances > 1 ? "s" : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-right">{status}</span>
      </footer>
    </div>
  );
}
