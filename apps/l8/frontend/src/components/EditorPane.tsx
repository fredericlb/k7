import { autocompletion } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { type Extension, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { Vim, vim } from "@replit/codemirror-vim";
import { type LintItem, lint, refreshLint } from "@studio/ui-editor/lint";
import { yamlCompletions } from "@studio/ui-editor/yaml/completions";
import { projectEntityLinks } from "@studio/ui-editor/yaml/entityLinks";
import { projectLanguage } from "@studio/ui-editor/yaml/language";
import { projectPreviewGutter } from "@studio/ui-editor/yaml/previewGutter";
import { schemaVocabulary } from "@studio/ui-editor/yaml/vocabulary";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";
import { m } from "../paraglide/messages.js";
import { sliceSymbolColors } from "../sliceSymbols";
import type {
  FileContent,
  Hints,
  PreviewReq,
  WebClip,
  WebProject,
} from "../types";
import { WaveformView } from "./WaveformView";

export function EditorPane({
  file,
  hints,
  vimMode,
  audioClip,
  preview,
  onClosePreview,
  onChange,
  onSave,
  onOpenEntity,
  onPreview,
  onSliceEdit,
  diagnostics,
  onEditorView,
}: {
  file: FileContent | null;
  hints: Hints;
  vimMode: boolean;
  // The clip whose waveform docks at the bottom of the CODE pane, so you read a clip's text under its waveform.
  audioClip: {
    project: WebProject;
    clip: WebClip;
    // Span the whole source rather than the clip's placed region — see WaveformView.
    whole?: boolean;
    sliceRanges?: { symbol: string; from: number; to: number }[];
  } | null;
  // A gutter-auditioned sound takes the strip over from `audioClip` until dismissed (onClosePreview).
  preview?: {
    project: WebProject;
    clip: WebClip;
    whole?: boolean;
    sliceRanges?: { symbol: string; from: number; to: number }[];
  } | null;
  onClosePreview?: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onOpenEntity?: (path: string) => void;
  // Audition a sample from a gutter play button on a source/clip/slice line.
  onPreview?: (req: PreviewReq) => void;
  // The docked slicer's drag: rewrite one symbol's from/to in THIS pane's buffer. Passed only
  // when the buffer is the file the slices live in — with it, the dock's windows grow handles.
  onSliceEdit?: (symbol: string, from: number, to: number) => void;
  // This file's load findings, already filtered, drawn inline as squiggles and refreshed on each poll.
  diagnostics?: LintItem[];
  // Hand the live CodeMirror view up, so the shell can ask it for its focus/undo depth (Ctrl+Z arbitration).
  onEditorView?: (view: EditorView | null) => void;
}) {
  // Keep Ctrl/Cmd-S pointed at the latest onSave without rebuilding the extensions on every keystroke.
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  // The lint extension reads diagnostics through this ref, so a new vet re-lints without reconfiguring the editor.
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const diagsRef = useRef<LintItem[]>(diagnostics ?? []);
  diagsRef.current = diagnostics ?? [];

  // Teach the ex line to save: unregistered, `:w` silently drops a vim user's edits. Same onSave as the button.
  useEffect(() => {
    Vim.defineEx("write", "w", () => saveRef.current());
  }, []);

  // A project file — the ones that get the language mode, completion, links and lint.
  const isProjectFile = !!file && /\.ya?ml$/i.test(file.path);
  const isStrudel = !!file && file.path.endsWith(".strudel");
  const extensions = useMemo<Extension[]>(() => {
    const ext: Extension[] = [];
    // Prec.highest: our extensions are concatenated AFTER basicSetup's, whose keymap would otherwise outrank vim's.
    if (vimMode) ext.push(Prec.highest(vim()));
    ext.push(
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => (saveRef.current(), true),
        },
      ]),
    );
    if (isProjectFile) {
      ext.push(
        projectLanguage(),
        // The vocabulary is DERIVED from the Zod schemas, which is what stops it drifting from the real fields.
        autocompletion({
          override: [yamlCompletions(schemaVocabulary(file?.path, hints))],
        }),
        // Inline squiggles from the load, reading diagnostics via the ref so the extension is stable across polls.
        lint(() => diagsRef.current),
      );
      if (onOpenEntity) ext.push(projectEntityLinks(hints, onOpenEntity));
      // A ▶ in the gutter on every source/clip/slice line auditions that sample.
      if (onPreview) ext.push(projectPreviewGutter(onPreview));
      // A slice-rack file: its symbol names painted in their slice's colour — the link to the
      // docked waveform's windows, made by hue. Any other file decorates nothing (see
      // sliceSymbols.ts; the inline per-symbol waveforms this replaced are gone).
      ext.push(sliceSymbolColors());
    } else if (isStrudel) ext.push(javascript()); // Strudel patterns are JS + mini-notation strings
    return ext;
  }, [
    isProjectFile,
    isStrudel,
    vimMode,
    hints,
    onOpenEntity,
    onPreview,
    file?.path,
  ]);

  // New diagnostics but the same document, so nudge the linter. A no-op until the view mounts (grids have none).
  useEffect(() => {
    if (cmRef.current?.view) refreshLint(cmRef.current.view);
  }, [diagnostics]);

  if (!file)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {m["editorPane.selectFile"]()}
      </div>
    );
  if (file.binary)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {file.path} — binary file, not editable here
      </div>
    );

  const body = (
    <CodeMirror
      ref={cmRef}
      value={file.content}
      theme="dark"
      height="100%"
      style={{ height: "100%", fontSize: "13px" }}
      // Disable basicSetup's autocompletion: its word-based sources would show up beside our schema-aware one.
      basicSetup={{ foldGutter: false, autocompletion: false }}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => onEditorView?.(view)}
    />
  );

  // An audio clip's waveform docks HERE, pinned to the bottom of the code pane (the editor is position:relative).
  // A dismissable gutter preview takes it over; with neither, there is no strip and the editor fills the pane.
  const strip = preview ?? audioClip;
  if (strip) {
    return (
      <div className="relative h-full">
        {body}
        <div className="absolute inset-x-0 bottom-0 z-20 h-40 shadow-[0_-4px_12px_rgba(0,0,0,0.35)]">
          <WaveformView
            project={strip.project}
            clip={strip.clip}
            whole={strip.whole}
            sliceRanges={strip.sliceRanges}
            // The slicer's edit gesture — only for the dock, never a dismissable preview: a
            // preview shows some OTHER file's sound, and its windows are not this buffer's.
            onSliceEdit={preview ? undefined : onSliceEdit}
            onClose={preview ? onClosePreview : undefined}
          />
        </div>
      </div>
    );
  }
  return body;
}
