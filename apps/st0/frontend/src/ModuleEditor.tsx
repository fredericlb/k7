// ModuleEditor.tsx — the host around the SHARED builder (@studio/ui-module-builder). The
// builder edits text and grid through the store this hands it; only a live plugin can say what
// its parameters are called, what they span and what presets it ships, so this owns the engine
// link and feeds those in. An absent engine is not an error.

import type { MediatekEntry } from "@studio/mediatek/types";
import { type BuilderPane, ModuleBuilder } from "@studio/ui-module-builder";
import { Plug, PlugZap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { library, moduleStore } from "./api";
import { baseModuleRefs, useEnginePlugins } from "./engine/baseModules";
import { readExtends, resolvePluginBlock } from "./engine/resolvePlugin";
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
  // The chosen machine's plugin catalogue. Off the ENGINE, because the médiathèque's backend
  // serves a volume of files and has never seen a plugin scan — see ../docs/completion.md.
  const scanned = useEnginePlugins(client, connected);
  // What `extends:` may name.
  const baseModules = useMemo(() => baseModuleRefs(scanned), [scanned]);
  const [status, setStatus] = useState("");
  const [vimMode, setVimMode] = useState(
    () => localStorage.getItem(VIM_KEY) === "1",
  );
  // Bumped on save, so the engine reloads the module and re-reports its parameters.
  const [reload, setReload] = useState(0);
  const path = `${entry.path}/module.yaml`;

  /**
   * Put the module into the engine as soon as there is one. The page reads the same file for
   * its text; this second read only wants the plugin, and is cheap.
   *
   * Through `extends`, and that is the whole of it: a FACE declares nothing but that ref (see
   * @studio/song's engineFace.ts), so reading the text alone found no `plugin:` block, asked
   * the engine to load nothing, and every one of those modules showed an empty parameter list.
   *
   * `scanned` is a dependency and NOT a precondition. Gating on it would have a machine that
   * has never scanned show nothing for a `jsdsp` module either — one that names its plugin
   * outright and needs no catalogue at all. Arriving late simply re-runs this.
   */
  /**
   * What the resolution found, so the footer can SAY when it found nothing.
   *
   * An empty parameter list has three causes that look identical on screen — no engine, a ref
   * this machine has not scanned, a module that names no plugin at all — and only the first
   * was ever worded. The other two read as the editor being broken.
   */
  const [plugged, setPlugged] = useState<{
    ref: string;
    found: boolean;
  } | null>(null);

  useEffect(() => {
    if (phase.k !== "ready") return;
    let alive = true;
    void library
      .readFile(path)
      .then(async (f) => {
        const plugin = await resolvePluginBlock(f.content, scanned, (p) =>
          library.readFile(p).then((m) => m.content),
        );
        if (!alive) return;
        setPlugged({ ref: readExtends(f.content), found: !!plugin });
        preview(entry.name, plugin);
        listPresets(entry.name);
      })
      .catch(() => {
        /* an unreadable module simply has no parameters to offer */
      });
    return () => {
      alive = false;
    };
  }, [path, entry.name, phase.k, scanned, preview, listPresets, reload]);

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
            {/* Said only when there is an engine: without one the line beside it already
                explains the empty list, and two explanations for one symptom is one too many. */}
            {plugged && !plugged.found ? (
              <span className="text-destructive">
                {plugged.ref
                  ? ` — ${plugged.ref} : ce moteur n'a pas ce greffon, aucun paramètre à lister`
                  : " — ce module ne nomme aucun greffon"}
              </span>
            ) : null}
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
