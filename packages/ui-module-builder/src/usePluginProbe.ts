// usePluginProbe.ts — what the builder asks the MACHINE about a module's plugin, on purpose and
// never on its own: a scan of its parameters, its native window, a snapshot of its state as a
// named base, and the bases the module may be set to. Every answer is kept while the builder is
// open and never persisted. See docs/builder.md.

import type { ParamMeta } from "@studio/engine-protocol";
import { askText } from "@studio/project-shell/ask";
import { builtinPluginForRef } from "@studio/song-schema/builtinParams";
import { useCallback, useEffect, useState } from "react";
import { extendsRefOf } from "./moduleUi";
import type { ModuleStore } from "./store";

export function usePluginProbe({
  store,
  path,
  content,
  reloadKey,
  onScanParams,
  onShowNativeUI,
}: {
  store: ModuleStore;
  path: string;
  content: string | null;
  /** Bumped by the builder's Refresh, which re-reads the bases with the files. */
  reloadKey: number;
  onScanParams?: (base: string) => Promise<{
    names: string[];
    meta: Record<string, ParamMeta>;
  } | null>;
  onShowNativeUI?: (base: string) => Promise<unknown>;
}) {
  /** What a deliberate scan answered, kept while the builder is open and NEVER persisted — docs/builder.md. */
  const [scanned, setScanned] = useState<{
    names: string[];
    meta: Record<string, ParamMeta>;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // Only an `@engine/…` ref names a plugin a machine can load, so only that is worth asking about.
  const scanBase =
    content == null
      ? ""
      : (extendsRefOf(content) ?? "").startsWith("@engine/")
        ? (extendsRefOf(content) ?? "")
        : "";
  const runScan = useCallback(() => {
    if (!onScanParams || scanning || !scanBase) return;
    setScanning(true);
    setScanNote(null);
    void onScanParams(scanBase)
      .then((found) => {
        setScanned(found);
        setScanNote(
          !found
            ? "this machine cannot load that plugin — the engine's log says which of the two it is: not found, or refused to instantiate. That is a licence or an installation, not the plugin."
            : found.names.length
              ? `${found.names.length} parameters read from the plugin`
              : "the plugin loads and publishes no parameter to its host",
        );
      })
      .catch((e: Error) => setScanNote(`cannot read: ${e.message}`))
      .finally(() => setScanning(false));
  }, [onScanParams, scanning, scanBase]);

  /** A NARROWER base than the scan's, only an installed plugin having a window — see docs/builder.md. */
  const nativeUiBase =
    scanBase && !builtinPluginForRef(scanBase) ? scanBase : "";
  const [openingUi, setOpeningUi] = useState(false);
  const runNativeUi = useCallback(() => {
    if (!onShowNativeUI || openingUi || !nativeUiBase) return;
    setOpeningUi(true);
    setScanNote(null);
    void onShowNativeUI(nativeUiBase)
      .then(() =>
        // Said once the ENGINE has drawn one, and said EVERY time — see docs/builder.md.
        setScanNote(
          "the plugin's window is open on the engine's machine — that is a separate instance, and nothing touched there is saved",
        ),
      )
      .catch((e: Error) => setScanNote(`cannot open: ${e.message}`))
      .finally(() => setOpeningUi(false));
  }, [onShowNativeUI, openingUi, nativeUiBase]);

  /** The bases this module may be set to, asked of the HOST because the useful list is its ancestors' too. */
  const [bases, setBases] = useState<string[]>([]);
  const [basesKey, setBasesKey] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadKey` and `basesKey` are TRIGGERS, not values this body reads.
  useEffect(() => {
    if (!store.bases) return;
    let live = true;
    void store
      .bases(path)
      .then((b) => live && setBases(b))
      .catch(() => live && setBases([]));
    return () => {
      live = false;
    };
  }, [store, path, basesKey, reloadKey]);

  const [snapping, setSnapping] = useState(false);
  const snapBase = useCallback(async () => {
    if (!store.snapshotBase || snapping || !nativeUiBase) return;
    const name = await askText({
      title: "Keep the plugin's current state",
      body: "It is written into base/, where a parameter can then bind to it.",
      placeholder: "the base's name",
      confirmLabel: "Garder",
      // It becomes a FILE name, so the characters a path cannot hold are refused here rather than by the write.
      validate: (v) =>
        !v.trim()
          ? "a base carries a name"
          : /[/\\:*?"<>|]/.test(v)
            ? 'no / \\ : * ? " < > | — it is a file name'
            : "",
    });
    if (!name?.trim()) return;
    setSnapping(true);
    setScanNote(null);
    void store
      .snapshotBase(path, name.trim(), nativeUiBase)
      .then((w) => {
        setScanNote(`base kept: ${w.path}`);
        setBasesKey((k) => k + 1); // it is bindable now, so the row has to know about it
      })
      // The message is the HOST's: only the side that asked the engine knows what failed.
      .catch((e: Error) => setScanNote(`base impossible : ${e.message}`))
      .finally(() => setSnapping(false));
  }, [store, snapping, nativeUiBase, path]);

  return {
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
  };
}
