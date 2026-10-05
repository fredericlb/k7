// LibraryEditsRow.tsx — the row at the bottom of the editor while an admin's own copy of the
// libraries holds work their remotes do not: which libraries, how much, and the two ways out —
// commit and push it, or throw it away. Nothing in a library is published by a Save; this row is
// the one place it is. See ../../docs/sharedModules.md and packages/file-service/docs/libraries.md.

import { Button } from "@frediverse/ui/button";
import {
  FileDiff,
  GitCommitHorizontal,
  Loader2,
  Undo2,
} from "@frediverse/ui/icons";
import { askConfirm, askText } from "@studio/project-shell/ask";
import { showToast } from "@studio/project-shell/toast";
import type { LibraryEditsStatus } from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import { api, engines } from "../api";
import { m } from "../paraglide/messages.js";
import { LibraryDiffDialog } from "./LibraryDiffDialog";

/** How often to ask again: a library write moves no workspace revision. */
const POLL_MS = 3000;

export function LibraryEditsRow({ rev }: { rev: string | number | null }) {
  const [admin, setAdmin] = useState(false);
  const [edits, setEdits] = useState<LibraryEditsStatus["libraries"]>([]);
  const [busy, setBusy] = useState<"commit" | "discard" | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);

  // Only an admin edits a library, so only an admin has anything to be told here.
  useEffect(() => {
    let live = true;
    void engines
      .hostedFiles()
      .then((h) => live && setAdmin(h?.admin === true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const read = useCallback(async () => {
    try {
      setEdits((await api.libraryEdits()).libraries);
    } catch {
      setEdits([]); // a service that does not answer has nothing to report
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `rev` is the trigger, not an input.
  useEffect(() => {
    if (admin) void read();
  }, [admin, read, rev]);

  // Polled: the first edit of a library is made from any pane, with no revision to say so.
  useEffect(() => {
    if (!admin) return;
    const t = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(t);
  }, [admin, read]);

  if (!edits.length) return null;
  const libraries = edits.map((e) => `@${e.library}`).join(", ");

  const commit = async () => {
    const message = await askText({
      title: m["libedits.commitTitle"]({ libraries }),
      body: m["libedits.commitBody"](),
      placeholder: m["libedits.commitPlaceholder"](),
      confirmLabel: m["libedits.commit"](),
      validate: (v) => (v.trim() ? "" : m["libedits.commitNeedsMessage"]()),
    });
    if (!message) return;
    setBusy("commit");
    try {
      const r = await api.commitLibraryEdits(message.trim());
      showToast({ message: r.note, variant: r.pushed ? "success" : "error" });
    } catch (e) {
      showToast({ message: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
      await read();
    }
  };

  const discard = async () => {
    const agreed = await askConfirm({
      title: m["libedits.discardTitle"]({ libraries }),
      body: m["libedits.discardBody"](),
      confirmLabel: m["libedits.discard"](),
      danger: true,
    });
    if (!agreed) return;
    setBusy("discard");
    try {
      setEdits((await api.discardLibraryEdits()).libraries);
    } catch (e) {
      showToast({ message: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
      <span className="shrink-0 font-medium">{m["libedits.title"]()}</span>
      <span className="min-w-0 flex-1 truncate">
        {edits
          .map((e) =>
            m["libedits.pending"]({
              library: e.library,
              changed: e.changed,
              ahead: e.ahead,
            }),
          )
          .join(" · ")}
      </span>
      <Button size="sm" variant="ghost" onClick={() => setDiffOpen(true)}>
        <FileDiff className="h-3.5 w-3.5" /> {m["libedits.diff"]()}
      </Button>
      <LibraryDiffDialog
        libraries={edits.map((e) => e.library)}
        open={diffOpen}
        onOpenChange={setDiffOpen}
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null}
        onClick={() => void discard()}
      >
        {busy === "discard" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Undo2 className="h-3.5 w-3.5" />
        )}{" "}
        {m["libedits.discard"]()}
      </Button>
      <Button size="sm" disabled={busy !== null} onClick={() => void commit()}>
        {busy === "commit" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <GitCommitHorizontal className="h-3.5 w-3.5" />
        )}{" "}
        {m["libedits.commit"]()}
      </Button>
    </div>
  );
}
