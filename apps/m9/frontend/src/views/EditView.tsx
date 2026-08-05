// EditView.tsx — the project's files as a tree, and the open one as text. l8's editor without
// its timeline: the same CodeMirror language stack (@studio/ui-editor), the same save, the
// same fork-on-save answer from the file service. See ../../docs/views.md.

import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { yamlCompletions } from "@studio/ui-editor/yaml/completions";
import { projectLanguage } from "@studio/ui-editor/yaml/language";
import { schemaVocabulary } from "@studio/ui-editor/yaml/vocabulary";
import type { Hints } from "@studio/web-protocol";
import CodeMirror from "@uiw/react-codemirror";
import { Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";

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
        setText(f.content);
        setSaved(f.content);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // reloadKey forces a re-read after an undo/redo touched the open file (path didn't change).
  }, [path, reloadKey]);

  const save = useCallback(() => {
    if (!path) return;
    setBusy(true);
    setError(null);
    void api
      .write(path, text)
      .then((r) => {
        setSaved(text);
        // A save aimed at the shared `_modules` library lands on a project copy instead, and
        // the file being edited has just moved — say so rather than leaving a stale path.
        if (r.forked) setNote(`copié dans le projet : ${r.forked.path}`);
        onSaved();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }, [path, text, onSaved]);

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

  const dirty = text !== saved;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="truncate font-mono">{path}</span>
        {dirty && <span className="text-amber-500">modifié</span>}
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        <button
          type="button"
          className="ml-auto flex items-center gap-1 rounded bg-secondary px-2 py-1 disabled:opacity-50"
          disabled={!dirty || busy}
          onClick={save}
        >
          <Save className="h-3 w-3" /> Enregistrer
        </button>
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
          // Ctrl/Cmd+S saves, the one binding worth having before a command bar exists.
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              save();
            }
          }}
        />
      </div>
    </div>
  );
}
