// SeqGridFile.tsx — one sequence FILE behind a note grid: reads it once, writes every edit.
// The half of `SeqGridPane` that is not its frame, held apart so the clip pane can mount the
// same tracker without a second copy of "read, hand to the grid, write back". `SeqGrid` itself
// stays controlled and file-blind. See docs/noteGrids.md.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { SeqView } from "../sequenceEdit";
import type { Hints } from "../types";
import { SeqGrid } from "./SeqGrid";

export function SeqGridFile({
  path,
  view,
  racks,
  onChanged,
  setStatus,
}: {
  path: string;
  view: SeqView;
  /** The rack vocabulary the grid relabels notes with — the host fetches it with its own hints. */
  racks: Hints["racks"];
  // A write landed: the polls need to pick the notes up (the timeline draws them too).
  onChanged: () => void;
  setStatus: (s: string) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read ONCE per file. Deliberately not on the reload poll: the content here is what the grid
  // is editing, and refetching under a hand mid-edit is how a cursor and a half-typed note are
  // lost. An edit made elsewhere therefore needs the grid reopening — which switching view or
  // closing the pane makes cheap.
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
    return () => {
      done = true;
    };
  }, [path]);

  // Every edit is written. A grid edit is one whole gesture — a note drawn, a step typed — so
  // there is nothing a Save button would batch, and this has no buffer to lose it from.
  //
  // Straight to the file, where the sequencer and the roll write through `sequence note …`
  // commands. Both land in the same YAML; only the tracker's undo is the editor's rather than
  // the shell's journal, which is what typing into a grid of text already means.
  const write = (next: string) => {
    setContent(next);
    api
      .write(path, next)
      .then(() => onChanged())
      .catch((e) => setStatus(`could not save ${path}: ${e?.message ?? e}`));
  };

  if (error) return <div className="p-4 text-destructive text-sm">{error}</div>;
  if (content === null)
    return <div className="p-4 text-muted-foreground text-sm">loading…</div>;
  return (
    <SeqGrid
      view={view}
      content={content}
      racks={racks}
      resetKey={path}
      onChange={write}
    />
  );
}
