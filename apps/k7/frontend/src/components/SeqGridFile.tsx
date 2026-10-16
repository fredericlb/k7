// SeqGridFile.tsx — one sequence FILE behind a note grid: reads it, writes every edit in order.
// The half of `SeqGridPane` that is not its frame, held apart so the clip pane can mount the
// same tracker without a second copy of "read, hand to the grid, write back". `SeqGrid` itself
// stays controlled and file-blind. See docs/noteGrids.md.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SetStatus } from "../hooks/useLogs";
import { useQuietWrites, useRevision } from "../hooks/useRevision";
import { m } from "../paraglide/messages.js";
import type { SeqView } from "../sequenceEdit";
import type { Hints } from "../types";
import { SeqGrid } from "./SeqGrid";

export function SeqGridFile({
  path,
  view,
  racks,
  onChanged,
  setStatus,
  reloadKey = 0,
}: {
  path: string;
  view: SeqView;
  /** The rack vocabulary the grid relabels notes with — the host fetches it with its own hints. */
  racks: Hints["racks"];
  // A write landed: the polls need to pick the notes up (the timeline draws them too).
  onChanged: () => void;
  setStatus: SetStatus;
  /** The shell's reload counter: an undo or a command can rewrite this file, and this pane must follow. */
  reloadKey?: number;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read on opening the file; the re-read below follows the project, and keeps off the grid while a hand is on it.
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

  // Writes go one at a time, in order: two in flight could land the older snapshot last.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const lastEdit = useRef(0);

  // Re-read when the project moved — an undo, a command, a MIDI pass — but never under a hand: not mid-write, not within a second of an edit.
  const rev = useRevision();
  const quiet = useQuietWrites();
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the three counters are triggers; `path` is read through the closure.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pending.current || performance.now() - lastEdit.current < 1000) return;
    let done = false;
    api
      .read(path)
      .then((f) => {
        if (done || f.binary || pending.current) return;
        setContent((cur) => (cur === f.content ? cur : f.content));
      })
      .catch(() => {});
    return () => {
      done = true;
    };
  }, [rev, quiet, reloadKey]);

  // Every edit is written, straight to the file: a grid edit is one whole gesture, so there is nothing a Save button would batch.
  const write = (next: string) => {
    setContent(next);
    lastEdit.current = performance.now();
    pending.current++;
    queue.current = queue.current
      .then(() => api.write(path, next))
      .then(
        () => onChanged(),
        (e) =>
          setStatus(
            m["status.seq.saveFailed"]({ path, message: e?.message ?? e }),
            "error",
          ),
      )
      .finally(() => {
        pending.current--;
      });
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
