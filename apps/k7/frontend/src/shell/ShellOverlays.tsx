// ShellOverlays.tsx — every popin, dialog and menu the shell draws OVER its panes: the
// right-click menu, the pickers, the tap-chain and curve editors, the help page, the commands
// page, the assembly builder, the dialogs. What is open is the shell store's overlay slice.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import type { EngineClient } from "@studio/engine-browser";
import { Toaster } from "@studio/project-shell/toast";
import {
  type ComponentProps,
  lazy,
  type ReactNode,
  type RefObject,
  Suspense,
} from "react";
import { AskHostK7 } from "../AskHostK7";
import { api, moduleStore } from "../api";
import type { CommandPrefs } from "../commandPrefs";
import { AssetPicker } from "../components/AssetPicker";
import { CommandsSettings } from "../components/CommandsSettings";
import { ContextMenu } from "../components/ContextMenu";
import { CurveEditor } from "../components/CurveEditor";
import { EngineMissingDialog } from "../components/EngineMissingDialog";
import { EngineSyncFailedDialog } from "../components/EngineSyncFailedDialog";
import { syncRunning } from "../components/EngineSyncProgress";
import { HelpPage } from "../components/HelpPage";
import { ImportDialog } from "../components/ImportDialog";
import { ModulePicker } from "../components/ModulePicker";
import { TapChainEditor } from "../components/TapChainEditor";
import { TrackModulesPane } from "../components/TrackModulesPane";
import type { MenuItem } from "../contextMenu";
import { useGraphAt } from "../hooks/useGraphAt";
import type { useProjectImport } from "../hooks/useProjectDialogs";
import { isLibraryPath } from "../libraryTree";
import { PaneBoundary } from "../PaneBoundary";
import { PairRequestsPrompt } from "../pairing/PairRequestsPrompt";
import { m } from "../paraglide/messages.js";
import {
  useReloadKey,
  useShell,
  useShellStore,
  useVerbs,
} from "../state/shellStore";
import type { EngineSyncState, WebProject } from "../types";
import type { useGraphActions } from "./useGraphActions";

// The assembly builder carries an editor and a language of its own: loaded when opened, not with the shell.
const AssemblyBuilder = lazy(() =>
  import("@studio/ui-module-builder/assembly").then((mod) => ({
    default: mod.AssemblyBuilder,
  })),
);

const TAP_CHAIN_INPUT = {
  id: "tap-chain-input",
  get label() {
    return m["tapChain.input"]();
  },
  get sub() {
    return m["tapChain.inputSub"]();
  },
};

type GraphActions = ReturnType<typeof useGraphActions>;

export function ShellOverlays({
  commandPrefs,
  pickMenuItem,
  setMenuHint,
  presetPicker,
  liveCardProps,
  baseModules,
  onModulePick,
  projectDoc,
  engineSync,
  imp,
  allCommands,
  saveCommandPrefs,
  vimMode,
  paneError,
  engineRef,
  connected,
}: {
  commandPrefs: CommandPrefs;
  pickMenuItem: (item: MenuItem) => void;
  setMenuHint: ComponentProps<typeof ContextMenu>["onHint"];
  presetPicker: ReactNode;
  /** What a module card is drawn with, live — the tap chain's cards are the graph's own. */
  liveCardProps: Omit<
    ComponentProps<typeof TrackModulesPane>,
    "trackId" | "nodes" | "lead"
  >;
  baseModules: GraphActions["baseModules"];
  onModulePick: GraphActions["onModulePick"];
  projectDoc: WebProject | null;
  engineSync: EngineSyncState | null;
  imp: ReturnType<typeof useProjectImport>;
  allCommands: ComponentProps<typeof CommandsSettings>["commands"];
  saveCommandPrefs: (next: CommandPrefs) => void;
  vimMode: boolean;
  paneError: ComponentProps<typeof PaneBoundary>["onError"];
  engineRef: RefObject<EngineClient | undefined>;
  connected: boolean;
}) {
  // What is open over the panes, read here rather than handed down (state/overlaySlice.ts).
  const menu = useShell((s) => s.menu);
  const tapChain = useShell((s) => s.tapChain);
  const modulePicker = useShell((s) => s.modulePicker);
  const curveEdit = useShell((s) => s.curveEdit);
  const assetPicker = useShell((s) => s.assetPicker);
  const commandsPage = useShell((s) => s.commandsPage);
  const assemblyBuilder = useShell((s) => s.assemblyBuilder);
  const assemblyUnlocked = useShell((s) => s.assemblyUnlocked);
  const undoConfirm = useShell((s) => s.undoConfirm);
  const frozen = useShell((s) => s.frozen);
  const showHelp = useShell((s) => s.showHelp);
  const reloadKey = useReloadKey();
  const { runCommand } = useVerbs();
  const {
    setMenu,
    setTapChain,
    setModulePicker,
    setCurveEdit,
    setAssetPicker,
    setCommandsPage,
    setAssemblyBuilder,
    setAssemblyUnlocked,
    setUndoConfirm,
    bumpReload,
    setShowHelp,
  } = useShellStore().getState();
  // The template's own graph is what the builder lists params from: an assembly folder IS a graph folder.
  const assemblyRead = useGraphAt(assemblyBuilder?.folder ?? null, reloadKey);
  const assemblyGraph = assemblyRead.error ? null : assemblyRead.graph;
  return (
    <>
      {/* right-click context menu — opened by the timeline and the chains graph */}
      {menu && (
        <ContextMenu
          items={menu.items}
          target={menu.target}
          // The icons and names this person chose, from `ui settings commands`.
          prefs={commandPrefs}
          x={menu.x}
          y={menu.y}
          onPick={pickMenuItem}
          // What the row under the pointer does, into the status line — stable, because the menu also calls it from an unmount cleanup.
          onHint={setMenuHint}
          onClose={() => setMenu(null)}
        />
      )}

      {/* "which file?" — a module widget's library browser, the same popup as the `+`: both are a nested catalogue. */}
      {presetPicker}
      {tapChain && (
        <TapChainEditor
          node={tapChain.node}
          tap={tapChain.tap}
          onAddModule={(x, y) =>
            setModulePicker({
              info: null,
              x,
              y,
              nameFor: (n) => n,
              onRef: (ref) =>
                void runCommand(
                  `node tap chain add ${JSON.stringify(tapChain.node)} ${JSON.stringify(tapChain.tap)} ${ref}`,
                ),
            })
          }
          renderCards={(nodes) => (
            <TrackModulesPane
              {...liveCardProps}
              trackId=""
              nodes={nodes}
              // The chain's start, as a node that says so and does nothing: the sound arrives from there.
              lead={TAP_CHAIN_INPUT}
            />
          )}
          onClose={() => setTapChain(null)}
        />
      )}
      {curveEdit && (
        <CurveEditor
          name={curveEdit.name}
          isNew={curveEdit.isNew}
          spec={curveEdit.spec}
          num={projectDoc?.timeSigNumerator ?? 4}
          den={projectDoc?.timeSigDenominator ?? 4}
          events={curveEdit.events}
          kind={curveEdit.kind}
          // An update writes the curve and nothing else; a new one is created, THEN bound — in that order.
          onSave={async (name, fields) => {
            const written = { ok: false };
            await runCommand(
              `curve set ${name} ${JSON.stringify(fields)}`,
              written,
            );
            const bind = curveEdit.bind;
            // Bound only once the curve EXISTS: a binding to a curve that was refused is dropped by the compile.
            if (bind && written.ok)
              await runCommand(
                `node automate ${bind.node} ${bind.param} ${name}`,
              );
          }}
          onClose={() => setCurveEdit(null)}
        />
      )}
      {assetPicker && (
        <AssetPicker
          x={assetPicker.x}
          y={assetPicker.y}
          param={assetPicker.param}
          files={assetPicker.files}
          family={assetPicker.family}
          onPick={(file) => {
            const { module, param, commit } = assetPicker;
            setAssetPicker(null);
            if (commit) return void runCommand(commit(file));
            // A file-valued param is a param — `node param <node> model <file>`, all three QUOTED, with `none` left bare (docs/moduleBuilder.md).
            void runCommand(
              file
                ? `node param "${module}" "${param}" "${file}"`
                : `node param "${module}" "${param}" none`,
            );
          }}
          onClose={() => setAssetPicker(null)}
        />
      )}

      {/* "which module?" — opened by the `+` on a graph arrow, before any command */}
      {modulePicker && (
        <ModulePicker
          x={modulePicker.x}
          y={modulePicker.y}
          baseModules={baseModules}
          onPick={onModulePick}
          onClose={() => setModulePicker(null)}
        />
      )}

      {/* The documentation at #help — a PAGE, not a popin, so the reference reads as one ctrl-F-able document. */}
      {showHelp && (
        <div className="fixed inset-0 z-50 bg-background">
          <HelpPage onBack={() => setShowHelp(false)} prefs={commandPrefs} />
        </div>
      )}

      {/* The SCREEN surfaces were mounted here; they are panes in the column above now — packages/song/docs/surfaces.md. */}

      {/* The project's files did not all reach the engine's machine: fatal until reloaded (engineSync.md). */}
      <EngineSyncFailedDialog
        sync={
          !frozen && engineSync && !syncRunning(engineSync) ? engineSync : null
        }
        onReload={async () => {
          await api.retryEngineSync();
        }}
      />

      {/* "import this .dawproject?" — clicking one in the tree lands here */}
      <ImportDialog
        path={imp.importPath}
        busy={imp.importing}
        error={imp.importError}
        log={imp.importLog}
        onConfirm={() => void imp.confirmImport()}
        onOpen={() => void imp.openImported()}
        onCancel={imp.cancelImport}
      />

      {/* COMMANDS is the one settings screen still drawn as a page: a catalogue does not fit a 24rem column (docs/shell.md). */}
      {commandsPage && (
        <div className="absolute inset-0 z-40 bg-background">
          <CommandsSettings
            // The whole catalogue, both halves: a page that arranged only one would order a menu it does not draw.
            commands={allCommands}
            prefs={commandPrefs}
            onSave={saveCommandPrefs}
            onBack={() => setCommandsPage(false)}
          />
        </div>
      )}

      {/* The shared module builder over the whole shell; it holds no engine link, so no factory banks and no live params (docs/moduleBuilder.md). */}
      {assemblyBuilder && (
        <div className="absolute inset-0 z-30 bg-background">
          <Suspense fallback={null}>
            <PaneBoundary
              name="assembly builder"
              resetKey={reloadKey}
              onError={paneError}
            >
              <AssemblyBuilder
                store={moduleStore}
                path={assemblyBuilder.file}
                graph={assemblyGraph}
                vimMode={vimMode}
                // A template lives in the library, so it opens the way a shared module does: locked.
                readOnly={
                  isLibraryPath(assemblyBuilder.file) && !assemblyUnlocked
                }
                onRequestEdit={
                  isLibraryPath(assemblyBuilder.file) && !assemblyUnlocked
                    ? () => setAssemblyUnlocked(true)
                    : undefined
                }
                onClose={() => {
                  setAssemblyBuilder(null);
                  setAssemblyUnlocked(false);
                  bumpReload();
                }}
              />
            </PaneBoundary>
          </Suspense>
        </div>
      )}

      {/* Confirm before undoing a process step — it restores a bounced audio file. */}
      <Dialog
        open={!!undoConfirm}
        onOpenChange={(o) => {
          if (!o && undoConfirm) {
            undoConfirm.resolve(false);
            setUndoConfirm(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{m["undo.processTitle"]()}</DialogTitle>
            <DialogDescription>
              {undoConfirm
                ? m["undo.processBody"]({
                    files: undoConfirm.files.join(", ") || undoConfirm.label,
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                undoConfirm?.resolve(false);
                setUndoConfirm(null);
              }}
            >
              {m["common.cancel"]()}
            </Button>
            <Button
              onClick={() => {
                undoConfirm?.resolve(true);
                setUndoConfirm(null);
              }}
            >
              {m["common.confirm"]()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Global toast notifications — positioned bottom-right, above everything */}
      <Toaster dismissLabel={m["common.dismiss"]()} />
      {/* A LAN device asking to pair, answered here when this page runs on the engine's machine — docs/pairing.md. */}
      <PairRequestsPrompt engine={engineRef.current} connected={connected} />
      {/* A sample, clip, patch or plugin the engine is playing the project without (engineMissing.ts). */}
      <EngineMissingDialog engine={engineRef.current} />
      {/* The app's own confirm/prompt, in place of the OS box that ignored the Escape ladder. */}
      <AskHostK7 />
    </>
  );
}
