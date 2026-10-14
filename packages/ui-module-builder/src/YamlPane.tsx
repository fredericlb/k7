// YamlPane.tsx — one of the module's files as text. YAML for three of them, FAUST or JavaScript
// for the sources, chosen by extension. Deliberately smaller than k7's EditorPane: no sequence tracker,
// no waveform, no video readers. Those exist because k7 edits a SONG's material.

import { autocompletion } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { faustLanguage } from "@studio/ui-editor/faust/language";
import type { YamlVocabulary } from "@studio/ui-editor/yaml/completions";
import { yamlCompletions } from "@studio/ui-editor/yaml/completions";
import { projectLanguage } from "@studio/ui-editor/yaml/language";
import { schemaVocabulary } from "@studio/ui-editor/yaml/vocabulary";
import type { Hints } from "@studio/web-protocol";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo, useRef } from "react";

/** Is this Faust source? The EXTENSION decides, since a pane is a place rather than a language. */
const isFaust = (path: string): boolean => path.toLowerCase().endsWith(".dsp");
const isJs = (path: string): boolean => path.toLowerCase().endsWith(".js");

export function YamlPane({
  path,
  content,
  hints,
  vocabulary,
  vimMode,
  readOnly,
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
  onChange: (next: string) => void;
  onSave: () => void;
}) {
  // Through a ref, so a vocabulary that ARRIVES does not rebuild the extension set under a cursor.
  const vocab = vocabulary ?? schemaVocabulary(path, hints);
  const vocabRef = useRef(vocab);
  vocabRef.current = vocab;

  const faust = isFaust(path);
  const js = isJs(path);
  const extensions = useMemo(() => {
    const base = [
      faust ? faustLanguage() : js ? javascript() : projectLanguage(),
      // …and no YAML completions on a source file: schema-derived, so every one would be wrong there.
      ...(faust || js
        ? []
        : [
            autocompletion({
              override: [
                yamlCompletions({
                  fieldsAt: (p) => vocabRef.current.fieldsAt(p),
                  valuesAt: (p, f) => vocabRef.current.valuesAt?.(p, f) ?? [],
                }),
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
    ];
    return vimMode && !readOnly ? [vim(), ...base] : base;
  }, [vimMode, readOnly, onSave, faust, js]);

  return (
    <CodeMirror
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
