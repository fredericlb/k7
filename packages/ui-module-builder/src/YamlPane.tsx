// YamlPane.tsx — one of the module's files as text. YAML for three of them and FAUST for the
// fourth, chosen by extension. Deliberately smaller than st0's EditorPane: no sequence tracker,
// no waveform, no video readers. Those exist because st0 edits a SONG's material.

import { autocompletion } from "@codemirror/autocomplete";
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

/**
 * Is this file Faust source? The EXTENSION decides, not the tab.
 *
 * The tab knows which pane is up, and the pane is a place rather than a language — `dsp` shows
 * `jsdsp.ts` for one module and `dsp.dsp` for another. The filename is the one thing that always
 * says which, and it is the same fact the compiler reads (`FAUST_FILE`).
 */
const isFaust = (path: string): boolean => path.toLowerCase().endsWith(".dsp");

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
  /**
   * What may be written here, when the PATH cannot say.
   *
   * `schemaVocabulary` is the adapter to a studio project, and answers nothing for a file
   * that is not one — a médiathèque playlist, whose values are songs. The caller holding
   * such a listing supplies its own rather than teaching the project schemas about it.
   */
  vocabulary?: YamlVocabulary;
  vimMode: boolean;
  /**
   * Show the file without letting anyone type into it.
   *
   * Vim goes with it rather than staying on: `editable={false}` refuses the change, so an
   * insert mode that accepted keystrokes and dropped them would be the one state worse than
   * a pane that plainly does not take them. Completion and folding stay — reading is the
   * whole point of this mode.
   */
  readOnly?: boolean;
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

  const faust = isFaust(path);
  const extensions = useMemo(() => {
    const base = [
      faust ? faustLanguage() : projectLanguage(),
      // …and no YAML completions on a Faust file. They are derived from the project's SCHEMAS,
      // so on a `.dsp` every one of them would be a wrong answer offered confidently.
      ...(faust
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
    return vimMode && !readOnly ? [vim(), ...base] : base;
  }, [vimMode, readOnly, onSave, faust]);

  return (
    <CodeMirror
      value={content}
      /**
       * BOTH, and the second one is the whole fix for "the page scrolls instead of the editor".
       *
       * `height` is a CodeMirror theme rule — it sets `.cm-editor { height: 100% }`. `style` goes
       * on the wrapper `<div class="cm-theme">` that react-codemirror renders around it, and
       * without a height there that wrapper is auto: the editor's 100% then resolves against
       * nothing, so it grows to fit its text, pushes the pane past the viewport, and what
       * scrolls is the PAGE. st0's own EditorPane has carried both since it was written; this
       * one had only the first.
       */
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
