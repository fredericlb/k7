// YamlPane.tsx — the module's YAML as text, for either file of the pair. Deliberately smaller
// than l8' EditorPane: no sequence tracker, no waveform, no video readers. Those exist
// because l8 edits a SONG's material; a module is a page of YAML.

import { autocompletion } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import type { YamlVocabulary } from "@studio/ui-editor/yaml/completions";
import { yamlCompletions } from "@studio/ui-editor/yaml/completions";
import { projectLanguage } from "@studio/ui-editor/yaml/language";
import { schemaVocabulary } from "@studio/ui-editor/yaml/vocabulary";
import type { Hints } from "@studio/web-protocol";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo, useRef } from "react";

export function YamlPane({
  path,
  content,
  hints,
  vocabulary,
  vimMode,
  onChange,
  onSave,
}: {
  path: string;
  content: string;
  hints?: Hints;
  /**
   * What may be written here, when the PATH cannot say.
   *
   * `schemaVocabulary` is the adapter to a studio project, and answers nothing for a file
   * that is not one — a médiathèque playlist, whose values are songs. The caller holding
   * such a listing supplies its own rather than teaching the project schemas about it.
   */
  vocabulary?: YamlVocabulary;
  vimMode: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
}) {
  // Read through a ref, so a vocabulary that ARRIVES — hints fetched, a songs listing polled
  // every three seconds — does not rebuild the extension set under a cursor. It used to be a
  // dependency of the memo below, which meant reconfiguring the language, vim and the keymap
  // for a list that is only ever consulted when the completion is asked for.
  const vocab = vocabulary ?? schemaVocabulary(path, hints);
  const vocabRef = useRef(vocab);
  vocabRef.current = vocab;

  const extensions = useMemo(() => {
    const base = [
      projectLanguage(),
      autocompletion({
        override: [
          yamlCompletions({
            fieldsAt: (p) => vocabRef.current.fieldsAt(p),
            valuesAt: (p, f) => vocabRef.current.valuesAt?.(p, f) ?? [],
          }),
        ],
      }),
      // Prec.highest so Mod-S beats CodeMirror's own bindings AND vim's — the one
      // keystroke a text editor must never lose to a plugin.
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
    return vimMode ? [vim(), ...base] : base;
  }, [vimMode, onSave]);

  return (
    <CodeMirror
      value={content}
      height="100%"
      theme="dark"
      extensions={extensions}
      onChange={onChange}
      basicSetup={{ foldGutter: true, highlightActiveLine: true }}
    />
  );
}
