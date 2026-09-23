// SaveState.tsx — what an autosaving editor says in place of a Save button: nothing while the
// file is saved, and the reason out loud while it is not. Its own component because
// "non enregistré" must read the same everywhere it can happen.

import { Loader2 } from "@frediverse/ui/icons";
import type { Autosave } from "@studio/ui-editor/autosave";

const LABEL: Record<Autosave["status"], string> = {
  clean: "enregistré",
  pending: "modifié",
  saving: "enregistrement…",
  held: "non enregistré",
  error: "échec de l'enregistrement",
};

/** Amber: the buffer is NOT on disk and will not get there on its own. */
const LOUD = new Set<Autosave["status"]>(["held", "error"]);

export function SaveState({
  autosave,
  className = "",
}: {
  autosave: Autosave;
  className?: string;
}) {
  const loud = LOUD.has(autosave.status);
  return (
    <span
      className={`flex min-w-0 items-center gap-1 text-xs ${
        loud ? "text-amber-500" : "text-muted-foreground"
      } ${className}`}
      title={autosave.reason ?? undefined}
    >
      {autosave.status === "saving" && (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      )}
      <span className="truncate">
        {LABEL[autosave.status]}
        {loud && autosave.reason ? ` — ${autosave.reason}` : ""}
      </span>
    </span>
  );
}
