// ModuleEditor.tsx — the host around the moved editor. The page edits text and grid; only
// a live plugin can say what its parameters are called, what they span and what presets it
// ships, so this owns the engine link and feeds those in. An absent engine is not an error.

import type { MediatekEntry } from "@studio/mediatek/types";
import { Plug, PlugZap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { library } from "./api";
import { readPluginBlock } from "./engine/preview";
import { useModuleEngine } from "./engine/useModuleEngine";
import { ModuleEditorPage } from "./ModuleEditorPage";

// Vim mode used to be a lanes setting; mediatek has no settings screen yet, so it lives on
// the toggle below and in localStorage. One key, one boolean.
const VIM_KEY = "mediatek.vim";

export function ModuleEditor({
  entry,
  onBack,
}: {
  entry: MediatekEntry;
  onBack: () => void;
}) {
  const {
    phase,
    paramNames,
    paramMeta,
    presets,
    preview,
    listPresets,
    setPreset,
  } = useModuleEngine();
  const [status, setStatus] = useState("");
  const [vimMode, setVimMode] = useState(
    () => localStorage.getItem(VIM_KEY) === "1",
  );
  // Bumped on save, so the engine reloads the module and re-reports its parameters.
  const [reload, setReload] = useState(0);
  const path = `${entry.path}/module.yaml`;

  // Put the module into the engine as soon as there is one. The page reads the same file
  // for its text; this second read only wants the `plugin:` block, and is cheap.
  useEffect(() => {
    if (phase.k !== "ready") return;
    let alive = true;
    void library
      .readFile(path)
      .then((f) => {
        if (!alive) return;
        preview(entry.name, readPluginBlock(f.content));
        listPresets(entry.name);
      })
      .catch(() => {
        /* an unreadable module simply has no parameters to offer */
      });
    return () => {
      alive = false;
    };
  }, [path, entry.name, phase.k, preview, listPresets, reload]);

  const onSaved = useCallback(() => setReload((n) => n + 1), []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <ModuleEditorPage
          path={path}
          kind="module"
          moduleName={entry.name}
          paramRef={null}
          vimMode={vimMode}
          onBack={onBack}
          onSaved={onSaved}
          setStatus={setStatus}
          presets={presets}
          onListPresets={listPresets}
          onSetPreset={setPreset}
          pluginParamNames={paramNames}
          pluginParamMeta={paramMeta}
        />
      </div>
      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        {phase.k === "ready" ? (
          <span className="flex items-center gap-1">
            <PlugZap className="h-3.5 w-3.5" /> moteur {phase.id}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Plug className="h-3.5 w-3.5" />
            {phase.k === "looking"
              ? "recherche d'un moteur…"
              : "aucun moteur — les paramètres du greffon resteront vides"}
          </span>
        )}
        <button
          type="button"
          className={vimMode ? "underline" : "underline opacity-50"}
          onClick={() => {
            const next = !vimMode;
            setVimMode(next);
            localStorage.setItem(VIM_KEY, next ? "1" : "0");
          }}
        >
          vim
        </button>
        <span className="min-w-0 flex-1 truncate text-right">{status}</span>
      </footer>
    </div>
  );
}
