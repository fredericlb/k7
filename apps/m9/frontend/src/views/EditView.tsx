// EditView.tsx — the project's files as a tree, and the open one as text. l8's editor without
// its timeline: the same CodeMirror language stack (@studio/ui-editor), the same autosave, the
// same fork-on-save answer from the file service. See ../../docs/views.md.

import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import { yamlCompletions } from "@studio/ui-editor/yaml/completions";
import { projectLanguage } from "@studio/ui-editor/yaml/language";
import { schemaVocabulary } from "@studio/ui-editor/yaml/vocabulary";
import type { Hints } from "@studio/web-protocol";
import CodeMirror from "@uiw/react-codemirror";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";

// What the toolbar says about the buffer. "clean" says nothing: a file that is saved is the
// normal state and does not need a badge.
const SAVE_LABEL: Record<string, string> = {
  clean: "",
  pending: "modifié",
  saving: "enregistrement…",
  held: "non enregistré",
  error: "échec de l'enregistrement",
};
const HELD = new Set(["held", "error"]);

export function EditView({
  path,
  hints,
  onSaved,
  onEditorView,
  reloadKey,
}: {
  /** The open file, project-relative, or null when nothing is open. */
  path: string | null;
  /** The project's vocabulary, for completions. Null until it has arrived. */
  hints: Hints | null;
  onSaved: () => void;
  /** Hand the live CodeMirror view up, for the shell's Ctrl+Z arbitration. */
  onEditorView?: (view: EditorView | null) => void;
  /** Bumped by the shell after an undo/redo so the open file is re-read from disk. */
  reloadKey?: number;
}) {
  const [text, setText] = useState("");
  // What was last read or written. Dirty is `text !== saved`, derived rather than a flag that
  // a failed save could leave lying.
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    setNote(null);
    void api
      .read(path)
      .then((f) => {
        if (cancelled) return;
        // An edit that could never be written — it did not compile — outlived the pane showing
        // it. Give it back rather than the disk copy, which is not what the author last typed.
        setText(recallBuffer(path) ?? f.content);
        setSaved(f.content);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // reloadKey forces a re-read after an undo/redo touched the open file (path didn't change).
  }, [path, reloadKey]);

  // No Save button: the file is written as soon as it is a document the compiler could read.
  const write = useCallback(
    async (next: string) => {
      if (!path) return;
      setError(null);
      const r = await api.write(path, next);
      setSaved(next);
      // A write aimed at the shared `_modules` library lands on a project copy instead, and
      // the file being edited has just moved — say so rather than leaving a stale path.
      if (r.forked) setNote(`copié dans le projet : ${r.forked.path}`);
      onSaved();
    },
    [path, onSaved],
  );
  const autosave = useAutosave({ path, text, saved, write });

  // YAML only — the project's own language. A file that is not one gets a plain editor rather
  // than completions for fields it does not have.
  const extensions = useMemo<Extension[]>(() => {
    if (!path?.match(/\.ya?ml$/)) return [];
    const ext: Extension[] = [projectLanguage()];
    // The vocabulary is DERIVED from the Zod schemas, which is what stops it drifting from
    // the real fields. It is per FILE: a track and a clip do not offer the same keys.
    if (hints)
      ext.push(
        autocompletion({
          override: [yamlCompletions(schemaVocabulary(path, hints))],
        }),
      );
    return ext;
  }, [hints, path]);

  if (!path)
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Choisissez un fichier dans l'arbre.
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="truncate font-mono">{path}</span>
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        <span
          className={`ml-auto shrink-0 truncate ${
            HELD.has(autosave.status)
              ? "text-amber-500"
              : "text-muted-foreground"
          }`}
          title={autosave.reason ?? undefined}
        >
          {SAVE_LABEL[autosave.status]}
          {autosave.reason && HELD.has(autosave.status)
            ? ` — ${autosave.reason}`
            : ""}
        </span>
      </div>
      {error && (
        <code className="shrink-0 bg-muted px-3 py-1 text-xs text-red-400">
          {error}
        </code>
      )}
      {note && (
        <code className="shrink-0 bg-muted px-3 py-1 text-xs text-amber-500">
          {note}
        </code>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeMirror
          value={text}
          height="100%"
          extensions={extensions}
          onChange={setText}
          onCreateEditor={(view) => onEditorView?.(view)}
          // Ctrl/Cmd+S still means "now" — it no longer means "at all", and it cannot write
          // what autosave is holding back: the rule is the document, not who asked.
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              autosave.flush();
            }
          }}
        />
      </div>
    </div>
  );
}
