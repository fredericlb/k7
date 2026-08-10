// SeqGridPane.tsx — a sequence's piano roll or tracker where the chains graph normally is,
// opened by `sequence edit roll|tracker <sequence>` and closed by the × back to the graph.
// Unlike the popin's tabs, this one owns the file: it reads it once and WRITES every edit,
// the way the timeline's roll already commits a drawn note. See docs/noteGrids.md.

import { Button } from "@frediverse/ui/button";
import { Grid3x3, Piano, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { fileStem } from "../projectPaths";
import type { SeqView } from "../sequenceEdit";
import type { Hints } from "../types";
import { SeqGrid } from "./SeqGrid";

export function SeqGridPane({
  path,
  view,
  onClose,
  onChanged,
  setStatus,
}: {
  path: string;
  view: SeqView;
  onClose: () => void;
  // A write landed: the polls need to pick the notes up (the timeline draws them too).
  onChanged: () => void;
  setStatus: (s: string) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [racks, setRacks] = useState<Hints["racks"]>({});
  const [error, setError] = useState<string | null>(null);

  // Read ONCE per file. Deliberately not on the reload poll: the content here is what the grid
  // is editing, and refetching under a hand mid-edit is how a cursor and a half-typed note are
  // lost. An edit made elsewhere therefore needs the pane reopening — which the × makes cheap.
  useEffect(() => {
    let done = false;
    setContent(null);
    setError(null);
    api
      .read(path)
      .then((f) => {
        if (done) return;
        if (f.binary) setError(`${path} is not a text file`);
        else setContent(f.content);
      })
      .catch((e) => !done && setError(String(e?.message ?? e)));
    api.hints().then((h) => !done && setRacks(h.racks));
    return () => {
      done = true;
    };
  }, [path]);

  // Every edit is written. A grid edit is one whole gesture — a note drawn, a step typed — so
  // there is nothing a Save button would batch, and this pane has no buffer to lose it from.
  const write = (next: string) => {
    setContent(next);
    api
      .write(path, next)
      .then(() => onChanged())
      .catch((e) => setStatus(`could not save ${path}: ${e?.message ?? e}`));
  };

  const Icon = view === "tracker" ? Grid3x3 : Piano;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{fileStem(path)}</span>
        <span className="text-xs text-muted-foreground">
          {view === "tracker" ? "tracker" : "piano roll"}
        </span>
        <span className="truncate text-xs text-muted-foreground">{path}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          className="ml-auto"
          title="back to the graph"
          aria-label="back to the graph"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="p-4 text-sm text-destructive">{error}</div>
        ) : content === null ? (
          <div className="p-4 text-sm text-muted-foreground">loading…</div>
        ) : (
          <SeqGrid
            view={view}
            content={content}
            racks={racks}
            resetKey={path}
            onChange={write}
          />
        )}
      </div>
    </div>
  );
}
