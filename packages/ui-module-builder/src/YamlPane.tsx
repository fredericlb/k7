// YamlPane.tsx — the module's YAML as text, for either file of the pair. Deliberately smaller
// than l8' EditorPane: no sequence tracker, no waveform, no video readers. Those exist
// because l8 edits a SONG's material; a module is a page of YAML.

import { autocompletion } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { yamlCompletions } from "@studio/ui-editor/yaml/completions";
import { projectLanguage } from "@studio/ui-editor/yaml/language";
import { schemaVocabulary } from "@studio/ui-editor/yaml/vocabulary";
import type { Hints } from "@studio/web-protocol";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

export function YamlPane({
  path,
  content,
  hints,
  vimMode,
  onChange,
  onSave,
}: {
  path: string;
  content: string;
  hints?: Hints;
  vimMode: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
}) {
  const extensions = useMemo(() => {
    const base = [
      projectLanguage(),
      autocompletion({
        override: [yamlCompletions(schemaVocabulary(path, hints))],
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
  }, [path, hints, vimMode, onSave]);

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
