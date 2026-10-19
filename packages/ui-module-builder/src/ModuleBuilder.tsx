// ModuleBuilder.tsx — the full-screen module editor: a file's text on the LEFT, a visual grid
// of the module's widgets on the RIGHT. TWO files, one screen — `module.k7x` says what the
// module is, `ui.k7x` beside it says how it's drawn — and the grid always edits the second,
// rewriting it in place so typing flows the other way whenever it still parses (the grid greys
// out when it doesn't). Everything file-shaped goes through the injected ModuleStore; the four
// files are useModuleFiles.ts, what the machine is asked is usePluginProbe.ts.

import { Loader2 } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { ParamMeta } from "@studio/engine-protocol";
import { alignTabs, reflowNarrow } from "@studio/panel-rules/layout-twins";
import { FILE_PARAMS } from "@studio/song-schema/moduleTypes";
import type { AutosaveStatus } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-editor/yaml-pane";
import type { PresetInfo } from "@studio/web-protocol";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { BuilderHeader, englishSaveLabel } from "./BuilderHeader";
import { InputChannelBar } from "./InputChannelBar";
import {
  channelOf,
  ioOf,
  type ModuleUI,
  setChannelIn,
  setStatusIn,
  statusOf,
} from "./moduleUi";
import { ParamsPane } from "./ParamsPane";
import { paneTabs } from "./paneTabs";
import { ShapeBar } from "./ShapeBar";
import type { ModuleStore } from "./store";
import { type AiOrganizeCall, useAiOrganize } from "./useAiOrganize";
import { useModuleFiles } from "./useModuleFiles";
import { stageFor, useParamRows } from "./useParamRows";
import { usePluginProbe } from "./usePluginProbe";
import { WidgetGridEditor } from "./WidgetGridEditor";

export type { AiOrganizeCall } from "./useAiOrganize";
export { pluginTypeOf } from "./useModuleFiles";

/** What the left column shows; `params` is the odd entry, being a list rather than a file — docs/builder.md. */
export type BuilderPane = "module" | "panel" | "dsp" | "widgets" | "params";

export function ModuleScreen({
  store,
  path,
  kind,
  moduleName,
  paramRef,
  vimMode,
  initialPane,
  readOnly,
  onRequestEdit,
  onBack,
  onDirtyChange,
  onSaved,
  setStatus,
  presets,
  onListPresets,
  onSetPreset,
  pluginParamNames,
  pluginParamMeta,
  onScanParams,
  onShowNativeUI,
  inputDevices,
  onRegroupInputs,
  baseModules,
  onRelocated,
  renderPreview,
  onAiOrganize,
  saveLabel = englishSaveLabel,
}: {
  // Everything file-shaped. The one thing the two apps don't share — see store.ts.
  store: ModuleStore;
  path: string; // the file being edited (the module, or the base it extends)
  kind: "base" | "module";
  moduleName: string; // the module that was clicked (for the title)
  // The ref whose params feed the `bind` dropdown. May be null — the list is then empty, free-text bind still works.
  paramRef: string | null;
  vimMode: boolean;
  // Which file the code pane opens on: the PANEL by default, or wherever the host says the click landed.
  initialPane?: BuilderPane;
  /** Show the module without editing it — the same screen with the writing off; see docs/builder.md. */
  readOnly?: boolean;
  /** The button that asks to be let in, drawn only when there IS one; the HOST answers by flipping `readOnly`. */
  onRequestEdit?: () => void;
  onBack: () => void;
  /** Whether any of the four files differs from disk — for a host that can swap this module for another. */
  onDirtyChange?: (dirty: boolean) => void;
  onSaved: () => void; // bump the shell's reloadKey so the listing refreshes
  setStatus: (s: string) => void;
  // Presets the module's external plugin offers, and the two calls behind the dropdown. Empty for a built-in.
  presets: PresetInfo[];
  onListPresets: (module: string) => void;
  onSetPreset: (module: string, sel: { index?: number; path?: string }) => void;
  // Live param names from the engine for the plugin loaded on this module's chain.
  pluginParamNames?: string[];
  // …and what each spans, so a bound widget adopts the real range instead of the placeholder 0..1.
  pluginParamMeta?: Record<string, ParamMeta>;
  /** Open the plugin's OWN window; it resolves when an engine TOOK the request, not when one is drawn. */
  onShowNativeUI?: (base: string) => Promise<unknown>;
  /** Ask the MACHINE what this plugin has, by loading one on purpose — SLOW; see docs/builder.md. */
  onScanParams?: (base: string) => Promise<{
    names: string[];
    meta: Record<string, ParamMeta>;
  } | null>;
  // The interface's inputs as the engine GROUPS them — a question only the machine with the sound card answers.
  inputDevices?: { name: string; channels: number[] }[];
  // Ask the interface to pair or split `channel`'s hardware pair; absent means only the existing grouping.
  onRegroupInputs?: (channel: number, stereo: boolean) => void;
  // Refs this module may `extends` when the STORE cannot say — the médiathèque has no plugin cache on disk.
  baseModules?: string[];
  // A save the host REDIRECTED: this component does not follow paths on its own — see docs/builder.md.
  onRelocated?: (path: string) => void;
  // What fills the box under the grid; the host owns its contents — packages/ui-chains-react/docs/hosting.md.
  renderPreview?: (view: {
    ui: ModuleUI;
    params: Record<string, number>;
    // The module's named bases: a dropdown bound to `@base` is filled by the graph, not by the file.
    bases: readonly string[];
    // The `widgets.js` AS EDITED, which draws the grid's lcdscreen widgets.
    script?: string;
    // The engine's stage the card's footer draws, which the panel never holds — engine docs/mix.md.
    stage: readonly string[];
  }) => ReactNode;
  /** Ask Claude for the panel; the HOST holds the key and the model, so absent means no button — docs/aiOrganize.md. */
  onAiOrganize?: AiOrganizeCall;
  /** The state beside Save, in the host's language; "clean" and "pending" are never asked — docs/builder.md. */
  saveLabel?: (status: AutosaveStatus, reason: string | null) => string;
}) {
  const {
    content,
    setContent,
    ui,
    parsable,
    hints,
    error,
    uiFile,
    dspFile,
    scriptFile,
    dirty,
    uiDirty,
    dspDirty,
    scriptDirty,
    anyDirty,
    dspSourceName,
    reloadKey,
    onUiChange,
    onPanelChange,
    onDspChange,
    onScriptChange,
    onCodeChange,
    saveState,
    saveAll,
    publishing,
    leave,
    refresh,
  } = useModuleFiles({
    store,
    path,
    readOnly,
    setStatus,
    onSaved,
    onRelocated,
    onBack,
    onDirtyChange,
  });
  /** The module's `status:` off the BUFFER, so the dropdown shows the edit you just made — docs/builder.md. */
  const moduleStatus = useMemo(() => statusOf(content ?? ""), [content]);
  // Which file the CODE pane shows; the PANEL opens first, being what the grid beside it edits.
  const [pane, setPane] = useState<BuilderPane>(initialPane ?? "panel");
  // Factory presets need a live plugin instance, so ask only when editing the module itself.
  useEffect(() => {
    if (kind === "module") onListPresets(moduleName);
  }, [kind, moduleName, onListPresets]);

  // Which sidecar the pane is on, as ONE expression: three places ask this, and three answers drift.
  const sidecar =
    pane === "panel"
      ? uiFile
      : pane === "dsp"
        ? dspFile
        : pane === "widgets"
          ? scriptFile
          : null;

  /** Apply a FACTORY preset — the plugin's own, which only a live plugin can load. */
  const applyPreset = useCallback(
    (p: PresetInfo) => {
      onSetPreset(moduleName, { index: p.index, path: p.path });
      setStatus(`preset: ${p.name}`);
    },
    [moduleName, onSetPreset, setStatus],
  );

  /** Which of the panel's two shapes the grid edits — the panel itself, or its `vertical` twin (docs/layouts.md). */
  const [shape, setShape] = useState<"horizontal" | "vertical">("horizontal");
  const editsVertical = shape === "vertical" && !!ui?.vertical;
  const shownUi: ModuleUI | null =
    ui && editsVertical && ui.vertical ? { ...ui.vertical } : ui;
  // An edit lands in the shape on screen; the pages stay one list, so the twin's tabs follow the panel's.
  const onShapeChange = useCallback(
    (next: ModuleUI) => {
      if (!ui) return;
      if (editsVertical) {
        const { cols, rows, widgets, tabs } = next;
        onUiChange({
          ...ui,
          vertical: { cols, rows, widgets, ...(tabs?.length ? { tabs } : {}) },
        });
      } else onUiChange(alignTabs({ ...next, vertical: ui.vertical }));
    },
    [ui, editsVertical, onUiChange],
  );

  /** Ctrl+S on the parameters pane, the one pane with no CodeMirror to wire it — see docs/builder.md. */
  useEffect(() => {
    if (pane !== "params") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "s" || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      void saveAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pane, saveAll]);

  /** The store's hints MERGED with the host's live-engine ones, deduped — see docs/builder.md. */
  const completionHints = useMemo(
    () =>
      hints && baseModules?.length
        ? {
            ...hints,
            baseModules: [...new Set([...baseModules, ...hints.baseModules])],
          }
        : hints,
    [hints, baseModules],
  );

  // What KIND of module this is, the PATH counting too: one under `io/IN/` is an input whatever it says.
  const io = content == null ? null : ioOf(content, path);

  const {
    scanned,
    scanning,
    scanNote,
    scanBase,
    runScan,
    nativeUiBase,
    openingUi,
    runNativeUi,
    bases,
    snapping,
    snapBase,
  } = usePluginProbe({
    store,
    path,
    content,
    reloadKey,
    onScanParams,
    onShowNativeUI,
  });

  const { rows: paramRows, values: paramValues } = useParamRows({
    content,
    ui,
    io,
    path,
    hints,
    paramRef,
    pluginParamNames,
    pluginParamMeta,
    scanned,
    bases,
  });

  // Claude's panel lands in the two buffers it replaces, exactly as a code edit would — docs/aiOrganize.md.
  const ai = useAiOrganize({
    call: onAiOrganize,
    module: moduleName,
    moduleText: content ?? "",
    params: paramRows,
    uiText: uiFile?.content ?? "",
    widgetsJs: scriptFile?.content ?? "",
    canWriteScript: !!scriptFile,
    uiPath: uiFile?.path ?? null,
    scriptPath: scriptFile?.path ?? null,
    onPanel: onPanelChange,
    onScript: onScriptChange,
    setStatus,
  });

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <BuilderHeader
        kind={kind}
        moduleName={moduleName}
        path={path}
        presets={presets}
        applyPreset={applyPreset}
        readOnly={readOnly}
        moduleStatus={moduleStatus}
        setModuleStatus={(s) => setContent((c) => setStatusIn(c ?? "", s))}
        onRequestEdit={onRequestEdit}
        leave={leave}
        refresh={refresh}
        saveAll={saveAll}
        anyDirty={anyDirty}
        publishing={publishing}
        saveState={saveState}
        saveLabel={saveLabel}
      />

      {error ? (
        <div className="p-4 text-sm text-red-400">
          couldn't open {path} — {error}
        </div>
      ) : content == null || !hints || !ui ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> loading…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Left column: the files on top, and under them the card they make. */}
          <div className="flex min-h-0 w-1/2 shrink-0 flex-col border-r border-border">
            {/* Three files, one pane, so it says which of them you are typing into. */}
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
              {/* Each tab is named by its FILE: they are three files on disk, not three views of one. */}
              {paneTabs({
                path,
                uiFile,
                dspFile,
                scriptFile,
                dspSourceName,
                ui,
                dirty: {
                  module: dirty,
                  panel: uiDirty,
                  dsp: dspDirty,
                  widgets: scriptDirty,
                },
              }).map(([id, label, isDirty, ready, note]) => (
                <button
                  key={id}
                  type="button"
                  disabled={!ready}
                  onClick={() => setPane(id)}
                  // What the name does not say lives here, so the tab reads as the file it opens.
                  title={note ? `${label} — ${note}` : label}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs",
                    pane === id
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                    !ready && "opacity-50",
                  )}
                >
                  {label}
                  {isDirty ? " *" : ""}
                </button>
              ))}
              {sidecar && pane !== "module" && (
                <span className="ml-auto truncate text-[11px] text-muted-foreground">
                  {sidecar.path}
                  {sidecar.exists ? "" : " (new)"}
                </span>
              )}
            </div>
            {/* `overflow-hidden` so the editor's own scroller moves and never this column. */}
            <div className="min-h-0 flex-1 overflow-hidden">
              {pane === "params" ? (
                <ParamsPane
                  rows={paramRows}
                  onScan={onScanParams && scanBase ? runScan : undefined}
                  scanning={scanning}
                  scanNote={scanNote}
                  onNativeUi={
                    onShowNativeUI && nativeUiBase ? runNativeUi : undefined
                  }
                  openingUi={openingUi}
                  onSnapshotBase={
                    store.snapshotBase && nativeUiBase && !readOnly
                      ? () => void snapBase()
                      : undefined
                  }
                  snapping={snapping}
                />
              ) : (
                <YamlPane
                  path={sidecar ? sidecar.path : path}
                  content={sidecar ? sidecar.content : content}
                  hints={completionHints ?? undefined}
                  vimMode={vimMode}
                  readOnly={readOnly}
                  onChange={
                    pane === "panel"
                      ? onPanelChange
                      : pane === "dsp"
                        ? onDspChange
                        : pane === "widgets"
                          ? onScriptChange
                          : onCodeChange
                  }
                  // Ctrl+S and vim's `:w` mean Save — the same button, not just this pane.
                  onSave={() => void saveAll()}
                />
              )}
            </div>
            {/* Under whichever pane is up, since `channel:` is what the module IS — ../docs/inputChannels.md. */}
            {io === "in" && (
              <InputChannelBar
                key={path}
                devices={inputDevices ?? []}
                channels={channelOf(content)}
                readOnly={!!readOnly}
                onPick={(chs) => onCodeChange(setChannelIn(content, chs))}
                onRegroup={onRegroupInputs}
              />
            )}
            {/* The bottom HALF: the node the panel becomes, beside the text that makes it — docs/builder.md. */}
            {renderPreview && (
              <div className="h-1/2 min-h-0 shrink-0 grow-0 border-t border-border">
                {renderPreview({
                  ui,
                  params: paramValues,
                  bases,
                  script: scriptFile?.content,
                  stage: stageFor(path, io),
                })}
              </div>
            )}
          </div>
          {/* Right column: the panel's geometry, the whole height. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Which of the panel's two shapes the grid edits, and what the pair still breaks — docs/layouts.md. */}
            <ShapeBar
              ui={ui}
              shape={shape}
              onShape={setShape}
              onSeed={() => onUiChange({ ...ui, vertical: reflowNarrow(ui) })}
              disabled={!uiFile || !parsable || !!readOnly}
            />
            <div className="min-h-0 flex-1">
              <WidgetGridEditor
                ui={shownUi ?? ui}
                // The params taking a FILE, a fixed list since the choices belong to the module.
                assetParams={[...FILE_PARAMS]}
                // …and every param there IS, which is what "Auto organize" proposes from — docs/builder.md.
                params={paramRows}
                // Three reasons a grid takes no drag, and only the FAULT gets a warning — docs/builder.md.
                disabled={
                  !uiFile
                    ? "locked"
                    : !parsable
                      ? "unparsable"
                      : readOnly
                        ? "locked"
                        : false
                }
                onChange={onShapeChange}
                onAiOrganize={ai.run}
                aiBusy={ai.busy}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
