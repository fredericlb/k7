// ModuleEditor.tsx — the host around the SHARED builder (@studio/ui-module-builder). The
// builder edits text and grid through the store this hands it; only a live plugin can say what
// its parameters are called, what they span and what presets it ships, so this owns the engine
// link and feeds those in. An absent engine is not an error.

import type { MediatekEntry } from "@studio/mediatek/types";
import { type BuilderPane, ModuleBuilder } from "@studio/ui-module-builder";
import { Plug, PlugZap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { library, moduleStore } from "./api";
import { useBaseModules } from "./engine/baseModules";
import { readPluginBlock } from "./engine/preview";
import { ModulePreview } from "./ModulePreview";
import { useEngine } from "./playback/PlaybackProvider";

// Vim mode used to be a l8 setting; st0 has no settings screen yet, so it lives on
// the toggle below and in localStorage. One key, one boolean.
const VIM_KEY = "st0.vim";

export function ModuleEditor({
  entry,
  pane,
  onBack,
}: {
  entry: MediatekEntry;
  // Which of the module's three files the click pointed at — the builder's code pane opens on it.
  pane?: BuilderPane;
  onBack: () => void;
}) {
  // The app's engine, which follows the header's picker on its own — this used to take the
  // chosen id as a prop and open a socket of its own, and a song that keeps playing while you
  // edit a module makes that a second client on one session.
  const {
    phase,
    client,
    connected,
    paramNames,
    paramMeta,
    presets,
    preview,
    listPresets,
    setPreset,
  } = useEngine();
  // What `extends:` may name. Off the ENGINE, because the médiathèque's backend serves a
  // volume of files and has never seen the plugin scan — see ../docs/completion.md.
  const baseModules = useBaseModules(client, connected);
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
        <ModuleBuilder
          store={moduleStore}
          path={path}
          kind="module"
          moduleName={entry.name}
          paramRef={null}
          vimMode={vimMode}
          initialPane={pane}
          onBack={onBack}
          onSaved={onSaved}
          setStatus={setStatus}
          presets={presets}
          onListPresets={listPresets}
          onSetPreset={setPreset}
          pluginParamNames={paramNames}
          pluginParamMeta={paramMeta}
          baseModules={baseModules}
          // The builder owns the box under the grid; the graph renderer needs OUR icons, so
          // what goes in it is supplied from here. See ModulePreview.tsx.
          renderPreview={({ ui, params }) => (
            <ModulePreview
              name={entry.name}
              path={entry.path}
              ui={ui}
              params={params}
            />
          )}
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
