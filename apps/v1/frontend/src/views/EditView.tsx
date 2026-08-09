// EditView.tsx — the project's files as text, and, for an open `video_tracks/*.yaml`, the
// readers strip beneath: one small <video> per placement, whose Set From / Set To write that
// placement's `source_from` / `length` into the BUFFER. The strip reads the text rather than
// the compiled document, because the buffer is a step ahead of what the compiler has seen.

import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  listVideoPlacements,
  setVideoPlacementField,
} from "@studio/song/yaml/videoTrackFile";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import { yamlCompletions } from "@studio/ui-editor/yaml/completions";
import { projectLanguage } from "@studio/ui-editor/yaml/language";
import { schemaVocabulary } from "@studio/ui-editor/yaml/vocabulary";
import type { Hints } from "@studio/web-protocol";
import CodeMirror from "@uiw/react-codemirror";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  type VideoReader,
  VideoReadersStrip,
} from "../components/VideoReadersStrip";

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
  readersFor,
  sources,
  onSaved,
  reloadKey,
}: {
  /** The open file, workspace-relative, or null when nothing is open. */
  path: string | null;
  /** The project's vocabulary, for completions. Null until it has arrived. */
  hints: Hints | null;
  /** True when the open file is a lane — the strip is drawn for it. */
  readersFor: boolean;
  /** Each clip ref's media path, from the compiled document. A ref missing from it has no
   *  reader, which is the honest answer: nothing knows what file it names yet. */
  sources: Record<string, string>;
  onSaved: () => void;
  /** Bumped by the shell after it wrote the open file itself (a timeline drag). */
  reloadKey?: number;
}) {
  const [text, setText] = useState("");
  // What was last read or written. Dirty is `text !== saved`, derived rather than a flag that
  // a failed save could leave lying.
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [strip, setStrip] = useState(true);

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
  }, [path, reloadKey]);

  // No Save button: the file is written as soon as it is a document the compiler could read.
  const write = useCallback(
    async (next: string) => {
      if (!path) return;
      setError(null);
      const r = await api.write(path, next);
      setSaved(next);
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
    // The vocabulary is DERIVED from the Zod schemas, which is what stops it drifting from the
    // real fields. It is per FILE: a lane and a clip do not offer the same keys.
    if (hints)
      ext.push(
        autocompletion({
          override: [yamlCompletions(schemaVocabulary(path, hints))],
        }),
      );
    return ext;
  }, [hints, path]);

  // Two sources, deliberately. The TIMES come from the BUFFER — a trim typed a second ago has
  // no compiled form yet, and a strip that waited for one would be a step behind every edit.
  // The FILE each ref names comes from the compiled document, because only the compiler has
  // read `clips/<ref>.yaml` to find out.
  const readers = useMemo<VideoReader[]>(() => {
    if (!readersFor || !strip) return [];
    return listVideoPlacements(text).flatMap((p) => {
      const src = sources[p.ref];
      return src
        ? [{ ref: p.ref, src, sourceFrom: p.sourceFrom, length: p.length }]
        : [];
    });
  }, [readersFor, sources, strip, text]);

  const setField = useCallback(
    (ref: string, field: "source_from" | "length", value: number) =>
      setText((t) => setVideoPlacementField(t, ref, field, value)),
    [],
  );

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
      {readers.length > 0 && (
        <div className="h-52 shrink-0 border-t border-border">
          <VideoReadersStrip
            readers={readers}
            onSetFrom={(ref, t) => setField(ref, "source_from", t)}
            // "To" is an END, and the file stores an EXTENT — the subtraction belongs here,
            // beside the only place that knows both numbers.
            onSetTo={(ref, t) => {
              const p = listVideoPlacements(text).find((x) => x.ref === ref);
              setField(ref, "length", Math.max(0, t - (p?.sourceFrom ?? 0)));
            }}
            onClose={() => setStrip(false)}
          />
        </div>
      )}
    </div>
  );
}
