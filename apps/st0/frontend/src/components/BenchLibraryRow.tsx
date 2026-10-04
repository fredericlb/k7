// BenchLibraryRow.tsx — the row at the bottom of the editor while a library's bench clone holds
// work its remote does not: how much, and the two ways out — commit and push it, or throw it
// away. Nothing in a library is published by a Save; this row is the one place it is.
// See ../../docs/sharedModules.md and packages/file-service/docs/libraries.md.

import { Button } from "@frediverse/ui/button";
import { GitCommitHorizontal, Loader2, Undo2 } from "@frediverse/ui/icons";
import { askConfirm, askText } from "@studio/project-shell/ask";
import { showToast } from "@studio/project-shell/toast";
import type { BenchLibraryStatus } from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";

/** How often to ask again while there is something to say: a library write moves no workspace revision. */
const POLL_MS = 3000;

export function BenchLibraryRow({ rev }: { rev: string | number | null }) {
  const [status, setStatus] = useState<BenchLibraryStatus | null>(null);
  const [busy, setBusy] = useState<"commit" | "discard" | null>(null);

  const read = useCallback(async () => {
    try {
      setStatus(await api.benchLibrary());
    } catch {
      setStatus(null); // a service that does not answer has no bench to report
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `rev` is the trigger, not an input.
  useEffect(() => {
    void read();
  }, [read, rev]);

  // Only a bench is worth polling: everywhere else the answer is null and stays so.
  useEffect(() => {
    if (!status) return;
    const t = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(t);
  }, [status, read]);

  if (!status || (!status.changed && !status.ahead)) return null;

  const commit = async () => {
    const message = await askText({
      title: m["bench.commitTitle"]({ library: status.library }),
      body: m["bench.commitBody"](),
      placeholder: m["bench.commitPlaceholder"](),
      confirmLabel: m["bench.commit"](),
      validate: (v) => (v.trim() ? "" : m["bench.commitNeedsMessage"]()),
    });
    if (!message) return;
    setBusy("commit");
    try {
      const r = await api.commitBenchLibrary(message.trim());
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
      title: m["bench.discardTitle"]({ library: status.library }),
      body: m["bench.discardBody"](),
      confirmLabel: m["bench.discard"](),
      danger: true,
    });
    if (!agreed) return;
    setBusy("discard");
    try {
      setStatus(await api.discardBenchLibrary());
    } catch (e) {
      showToast({ message: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate">
        {m["bench.pending"]({
          library: status.library,
          changed: status.changed,
          ahead: status.ahead,
        })}
      </span>
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
        {m["bench.discard"]()}
      </Button>
      <Button size="sm" disabled={busy !== null} onClick={() => void commit()}>
        {busy === "commit" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <GitCommitHorizontal className="h-3.5 w-3.5" />
        )}{" "}
        {m["bench.commit"]()}
      </Button>
    </div>
  );
}
