// YamlPane.tsx — one file as text, for the screens beside k7's editor: a module's files, a chain,
// a playlist. k7x, YAML (the médiathèque's files), FAUST or JavaScript, chosen by extension.
// Deliberately smaller than k7's EditorPane: no sequence tracker, no waveform, no video readers.

import { autocompletion } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import type { Hints } from "@studio/web-protocol";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useMemo, useRef } from "react";
import { editorLabel, vimModeStatus } from "./a11y";
import { useBufferSync } from "./bufferSync";
import { faustLanguage } from "./faust/language";
import { k7xCompletions } from "./k7x/completions";
import { k7xLanguage } from "./k7x/language";
import { vimUndoSteps } from "./vimUndo";
import { type YamlVocabulary, yamlCompletions } from "./yaml/completions";
import { projectLanguage } from "./yaml/language";
import { schemaVocabulary } from "./yaml/vocabulary";

/** Is this Faust source? The EXTENSION decides, since a pane is a place rather than a language. */
const isFaust = (path: string): boolean => path.toLowerCase().endsWith(".dsp");
const isJs = (path: string): boolean => path.toLowerCase().endsWith(".js");
const isK7x = (path: string): boolean => path.toLowerCase().endsWith(".k7x");

export function YamlPane({
  path,
  content,
  hints,
  vocabulary,
  vimMode,
  readOnly,
  label,
  onChange,
  onSave,
}: {
  path: string;
  content: string;
  hints?: Hints;
  /** What may be written here when the PATH cannot say — a caller holding a non-project listing supplies its own. */
  vocabulary?: YamlVocabulary;
  vimMode: boolean;
  /** Show the file without letting anyone type into it; VIM goes with it, since insert would drop keystrokes. */
  readOnly?: boolean;
  /** The textbox's accessible name, in the host's language; the path when absent. */
  label?: string;
  onChange: (next: string) => void;
  onSave: () => void;
}) {
  // Through a ref, so a vocabulary that ARRIVES does not rebuild the extension set under a cursor.
  const vocab = vocabulary ?? schemaVocabulary(path, hints);
  const vocabRef = useRef(vocab);
  vocabRef.current = vocab;

  const faust = isFaust(path);
  const js = isJs(path);
  const k7x = isK7x(path);
  const extensions = useMemo(() => {
    const vocabulary: YamlVocabulary = {
      fieldsAt: (p) => vocabRef.current.fieldsAt(p),
      valuesAt: (p, f) => vocabRef.current.valuesAt?.(p, f) ?? [],
    };
    const base = [
      faust
        ? faustLanguage()
        : js
          ? javascript()
          : k7x
            ? k7xLanguage()
            : projectLanguage(),
      // …and no completions on a source file: schema-derived, so every one would be wrong there.
      ...(faust || js
        ? []
        : [
            autocompletion({
              override: [
                k7x ? k7xCompletions(vocabulary) : yamlCompletions(vocabulary),
              ],
            }),
          ]),
      // Prec.highest so Mod-S beats CodeMirror's own bindings AND vim's.
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSave();
              return true;
            },
          },
        ]),
      ),
      editorLabel(label ?? path),
    ];
    return vimMode && !readOnly
      ? [vim(), vimUndoSteps(), ...base, vimModeStatus()]
      : base;
  }, [vimMode, readOnly, onSave, faust, js, k7x, label, path]);

  // A row edit beside the text lands as its own splices, so the cursor and the undo history stay.
  const cm = useRef<ReactCodeMirrorRef>(null);
  useBufferSync(() => cm.current?.view, content);

  return (
    <CodeMirror
      ref={cm}
      value={content}
      /** BOTH: without a height on the wrapper the editor's 100% resolves against nothing and the PAGE scrolls. */
      height="100%"
      style={{ height: "100%" }}
      theme="dark"
      extensions={extensions}
      editable={!readOnly}
      onChange={onChange}
      basicSetup={{ foldGutter: true, highlightActiveLine: true }}
    />
  );
}
