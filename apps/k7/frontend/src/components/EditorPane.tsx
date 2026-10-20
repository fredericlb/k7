import { autocompletion } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { type Extension, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { Vim, vim } from "@replit/codemirror-vim";
import { editorLabel, vimModeStatus } from "@studio/ui-editor/a11y";
import { useBufferSync } from "@studio/ui-editor/buffer-sync";
import { k7xCompletions } from "@studio/ui-editor/k7x/completions";
import { projectEntityLinks } from "@studio/ui-editor/k7x/entityLinks";
import { k7xLanguage } from "@studio/ui-editor/k7x/language";
import { projectPreviewGutter } from "@studio/ui-editor/k7x/previewGutter";
import { type LintItem, lint, refreshLint } from "@studio/ui-editor/lint";
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
  onPlayStrip,
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
    sliceRanges?: {
      symbol: string;
      from: number;
      to: number;
      hollow?: boolean;
    }[];
    // What the strip's ▶ sends, carried rather than derived: a rack's dock synthesises its id from a bare filename.
    play?: PreviewReq;
  } | null;
  // A gutter-auditioned sound takes the strip over from `audioClip` until dismissed (onClosePreview).
  preview?: {
    project: WebProject;
    clip: WebClip;
    whole?: boolean;
    sliceRanges?: {
      symbol: string;
      from: number;
      to: number;
      hollow?: boolean;
    }[];
    // The request that opened it — so ▶ replays exactly what the gutter played, slice window included.
    play?: PreviewReq;
  } | null;
  onClosePreview?: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onOpenEntity?: (path: string) => void;
  // Audition a sample from a gutter play button on a source/clip/slice line.
  onPreview?: (req: PreviewReq) => void;
  /** Audition the STRIP, answering the WINDOW the service resolved — separate from `onPreview`, whose request is not yet resolved. */
  onPlayStrip?: (
    req: PreviewReq,
  ) => Promise<{ start: number; length: number } | null>;
  // The docked slicer's drag: rewrite one symbol's from/to in THIS pane's buffer, passed only when the buffer holds the slices.
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

  // A workspace file — the ones that get the k7x mode, completion, links, the ▶ gutter and lint (packages/k7x/docs/language.md).
  const isK7xFile = !!file && /\.k7x$/i.test(file.path);
  const isStrudel = !!file && file.path.endsWith(".strudel");
  // The textbox's accessible name: the open file, `project.k7x — editor`.
  const label = file ? m["editorPane.label"]({ file: file.path }) : "";
  const extensions = useMemo<Extension[]>(() => {
    const ext: Extension[] = [];
    // Prec.highest: our extensions are concatenated AFTER basicSetup's, whose keymap would otherwise outrank vim's.
    if (vimMode) ext.push(Prec.highest(vim()), vimModeStatus());
    if (label) ext.push(editorLabel(label));
    ext.push(
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => (saveRef.current(), true),
        },
      ]),
    );
    if (isK7xFile) {
      ext.push(
        k7xLanguage(),
        // The vocabulary is DERIVED from the Zod schemas, which is what stops it drifting from the real fields.
        autocompletion({
          override: [k7xCompletions(schemaVocabulary(file?.path, hints))],
        }),
        // Inline squiggles from the load, reading diagnostics via the ref so the extension is stable across polls.
        lint(() => diagsRef.current),
      );
      if (onOpenEntity) ext.push(projectEntityLinks(hints, onOpenEntity));
      // A ▶ in the gutter on every source/clip/slice line auditions that sample.
      if (onPreview) ext.push(projectPreviewGutter(onPreview));
      // A slice-rack file: its symbol names painted in their slice's colour — the link to the docked waveform, made by hue.
      ext.push(sliceSymbolColors());
    } else if (isStrudel) ext.push(javascript()); // Strudel patterns are JS + mini-notation strings
    return ext;
  }, [
    isK7xFile,
    isStrudel,
    vimMode,
    label,
    hints,
    onOpenEntity,
    onPreview,
    file?.path,
  ]);

  // A dock gesture's edit reaches the view as its own splices, so the cursor and the undo history stay (packages/ui-editor/docs/k7xTree.md).
  useBufferSync(() => cmRef.current?.view, file?.content ?? "");

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

  // An audio clip's waveform docks HERE, pinned to the bottom of the code pane; a dismissable gutter preview takes it over.
  const strip = preview ?? audioClip;
  // A local, so the closure below narrows it: `strip` is a union and its field would stay optional.
  const playReq = strip?.play;
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
            // The slicer's edit gesture — only for the dock: a preview shows some OTHER file's sound, whose windows are not this buffer's.
            onSliceEdit={preview ? undefined : onSliceEdit}
            onClose={preview ? onClosePreview : undefined}
            // ▶ only when there is something to send it through AND a request describing the strip — a video clip's dock has neither.
            onPlay={
              onPlayStrip && playReq ? () => onPlayStrip(playReq) : undefined
            }
          />
        </div>
      </div>
    );
  }
  return body;
}
