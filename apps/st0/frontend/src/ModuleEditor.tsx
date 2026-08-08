// ModuleEditor.tsx — the host around the SHARED builder (@studio/ui-module-builder). The
// builder edits text and grid through the store this hands it; only a live plugin can say what
// its parameters are called, what they span and what presets it ships, so this owns the engine
// link and feeds those in. An absent engine is not an error.

import type { MediatekEntry } from "@studio/mediatek/types";
import { type BuilderPane, ModuleBuilder } from "@studio/ui-module-builder";
import { Mic, Plug, PlugZap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { engineMachine, library, moduleStore } from "./api";
import {
  baseModuleRefs,
  useEngineInputDevices,
  useEnginePlugins,
} from "./engine/baseModules";
import { InputPicker } from "./engine/InputPicker";
import {
  type ChannelLabel,
  inputChoices,
  inputLabel,
} from "./engine/inputChannels";
import { readExtends, resolvePluginBlock } from "./engine/resolvePlugin";
import { ModulePreview } from "./ModulePreview";
import { useEngine } from "./playback/PlaybackProvider";

// Vim mode used to be a l8 setting; st0 has no settings screen yet, so it lives on
// the toggle below and in localStorage. One key, one boolean.
const VIM_KEY = "st0.vim";

export function ModuleEditor({
  entry,
  pane,
  engineToken,
  onBack,
}: {
  entry: MediatekEntry;
  // Which of the module's three files the click pointed at — the builder's code pane opens on it.
  pane?: BuilderPane;
  /** The chosen machine's token — its file service, and behind it the channel labels. */
  engineToken?: string | null;
  onBack: () => void;
}) {
  // The app's engine, which follows the header's picker on its own — this used to take the
  // chosen id as a prop and open a socket of its own, and a song that keeps playing while you
  // edit a module makes that a second client on one session.
  const {
    phase,
    client,
    connected,
    fileBase,
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

  /**
   * What feeds the preview — the interface channels the engine monitors into this module.
   *
   * Empty by default, and deliberately not remembered on the account: an input is a fact
   * about the rig you are sitting at RIGHT NOW, and a module reopened next week on another
   * machine would otherwise start monitoring a channel that means something else there.
   */
  const [inputChannels, setInputChannels] = useState<number[]>([]);
  const [picking, setPicking] = useState<{ x: number; y: number } | null>(null);
  const inputDevices = useEngineInputDevices(client, connected);
  // The machine's channel LABELS. Its own fetch and not part of the engine socket: they live
  // in `~/.studio/preferences.yaml` beside the engine, which the file service serves.
  const [labels, setLabels] = useState<ChannelLabel[]>([]);
  useEffect(() => {
    if (!fileBase || !engineToken) return setLabels([]);
    let alive = true;
    void engineMachine
      .preferences(fileBase, engineToken)
      .then((p) => alive && setLabels(p.channels.in))
      // A machine that will not answer has no labels to give; the channel NUMBERS below are
      // what the picker really needs, and those come from the engine.
      .catch(() => alive && setLabels([]));
    return () => {
      alive = false;
    };
  }, [fileBase, engineToken]);
  const choices = useMemo(
    () => inputChoices(labels, inputDevices),
    [labels, inputDevices],
  );
  // Bumped on save, so the engine reloads the module and re-reports its parameters.
  const [reload, setReload] = useState(0);
  const path = `${entry.path}/module.yaml`;

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
   *
   * `inputChannels` is one too, so picking an input re-sends the document: what feeds the
   * module is part of what the engine is being asked to build.
   */
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
        preview(entry.name, plugin, undefined, inputChannels);
        listPresets(entry.name);
      })
      .catch(() => {
        /* an unreadable module simply has no parameters to offer */
      });
    return () => {
      alive = false;
    };
  }, [
    path,
    entry.name,
    phase.k,
    scanned,
    inputChannels,
    preview,
    listPresets,
    reload,
  ]);

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
              // The `in` node becomes a real source: pick a channel and what you play arrives
              // ahead of the module, monitored, so the panel moves and the treatment is
              // audible. See ../docs/modulePreview.md.
              sourceInput={inputLabel(inputChannels, choices)}
              onPickSourceInput={(x, y) => setPicking({ x, y })}
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
        {/* The input, HERE as well as on the `in` node.
            The node's chip is the right place to say what feeds the module — it is the thing
            being fed — but it is only drawn past a zoom of 0.6 (below that a node draws as its
            name alone, see DomChains' `far`), and the preview box is 30% of a column. A
            control you have to zoom in to find is one that reads as not being there. */}
        <button
          type="button"
          className="flex items-center gap-1 underline disabled:no-underline disabled:opacity-50"
          disabled={phase.k !== "ready"}
          title={
            phase.k === "ready"
              ? "Ce que le module écoute — une entrée de l'interface de cette machine"
              : "Il faut un moteur pour lire une entrée de l'interface"
          }
          onClick={(e) =>
            setPicking({
              x: e.currentTarget.getBoundingClientRect().left,
              y: e.currentTarget.getBoundingClientRect().top,
            })
          }
        >
          <Mic className="h-3.5 w-3.5" />
          entrée : {inputLabel(inputChannels, choices)}
        </button>
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

      {/* Rendered HERE and not inside the preview box: that box is 30% of a column and
          clips, and a menu opened near its bottom edge would be half a menu. Fixed
          positioning against the viewport, at the coordinates the node's chip reported. */}
      {picking && (
        <InputPicker
          at={picking}
          choices={choices}
          current={inputChannels}
          onPick={setInputChannels}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
