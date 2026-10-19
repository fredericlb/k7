// useModuleFiles.ts — the builder's four files: `module.k7x`, the `ui.k7x` beside it, a jsdsp or
// Faust source, and `widgets.js`. Read from the store, edited as buffers, saved together by one
// button and never by a timer, since on a shared module a save is a publish. Every "dirty" is
// DERIVED from what is on disk, never a flag. See docs/builder.md.

import {
  FAUST_FILE,
  FAUST_TYPE,
  JSDSP_FILE,
  JSDSP_TYPE,
} from "@studio/engine-protocol/build";
import { askConfirm } from "@studio/project-shell/ask";
import {
  dropBuffer,
  loudest,
  recallBuffer,
  useAutosave,
} from "@studio/ui-editor/autosave";
import { useUnsavedGuard } from "@studio/ui-editor/unsaved";
import type {
  Hints,
  ModuleSidecarFile,
  ModuleUiFile,
} from "@studio/web-protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  hasMalformedUiFile,
  type ModuleUI,
  readUiFile,
  writeUiFile,
} from "./moduleUi";
import type { ModuleStore } from "./store";

/** The DSP source a plugin type implies — ONE table, since the tab, the fetch and the stub must agree. */
const DSP_SOURCE: Record<string, string> = {
  [JSDSP_TYPE]: JSDSP_FILE,
  [FAUST_TYPE]: FAUST_FILE,
};

/** The `plugin(…)` statement's `type` off the RAW text: a regex, because mid-edit the document routinely does not parse. */
export function pluginTypeOf(text: string): string {
  const q = "[\"'`]";
  const object = new RegExp(
    `^plugin\\(\\s*\\{[^}]*?(?:\\btype|${q}type${q})\\s*:\\s*${q}([\\w-]+)${q}`,
    "m",
  );
  const chain = new RegExp(`^plugin\\(\\s*type\\(\\s*${q}([\\w-]+)${q}`, "m");
  return object.exec(text)?.[1] ?? chain.exec(text)?.[1] ?? "";
}

type SetSidecar = (
  f: (p: ModuleSidecarFile | null) => ModuleSidecarFile | null,
) => void;

export function useModuleFiles({
  store,
  path,
  readOnly,
  setStatus,
  onSaved,
  onRelocated,
  onBack,
  onDirtyChange,
}: {
  store: ModuleStore;
  path: string;
  readOnly?: boolean;
  setStatus: (s: string) => void;
  onSaved: () => void;
  onRelocated?: (path: string) => void;
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [ui, setUi] = useState<ModuleUI | null>(null);
  const [parsable, setParsable] = useState(true);
  const [hints, setHints] = useState<Hints | null>(null);
  // What is on disk, one string per file: every "dirty" is DERIVED from it, never a flag — docs/builder.md.
  const [savedModule, setSavedModule] = useState("");
  const [savedUi, setSavedUi] = useState("");
  const [savedDsp, setSavedDsp] = useState("");
  const [savedScript, setSavedScript] = useState("");
  const dirty = content != null && content !== savedModule;
  // The `ui.k7x` beside the module file, which is what the grid edits; it may not exist yet — docs/builder.md.
  const [uiFile, setUiFile] = useState<ModuleUiFile | null>(null);
  const uiDirty = !!uiFile && uiFile.content !== savedUi;
  // …and the third, which only a jsdsp module has: its own DSP source, fetched only when it claims one.
  const [dspFile, setDspFile] = useState<ModuleSidecarFile | null>(null);
  const dspDirty = !!dspFile && dspFile.content !== savedDsp;
  // …and the fourth, the script that draws the lcdscreen widgets — fetched whenever the host serves it.
  const [scriptFile, setScriptFile] = useState<ModuleSidecarFile | null>(null);
  const scriptDirty = !!scriptFile && scriptFile.content !== savedScript;
  const [error, setError] = useState<string | null>(null);

  // Whether the DSP is the module's own source and in which language, read off the BUFFER so the tab lands at once.
  const dspSourceName = useMemo(
    () =>
      content == null ? null : (DSP_SOURCE[pluginTypeOf(content)] ?? null),
    [content],
  );

  // Bumped by Refresh: every file read again from disk, for an edit made OUTSIDE the builder (../docs/builder.md).
  const [reloadKey, setReloadKey] = useState(0);

  // Load the file and the project's hints once, for this path — and again on a Refresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadKey` is a TRIGGER, not a value this body reads.
  useEffect(() => {
    let alive = true;
    setContent(null);
    setUiFile(null);
    setError(null);
    store
      .read(path)
      // Absent is a buffer, not an error — see ModuleStore.read.
      .then((text) => {
        if (!alive) return;
        // An edit that could never be written outlived this screen — give it back, not disk.
        setContent(recallBuffer(path) ?? text ?? "");
        setSavedModule(text ?? "");
      })
      .catch((e) => alive && setError((e as Error).message));
    // The panel is fetched separately and allowed to fail: a non-module still opens for its text.
    store
      .moduleUi(path)
      .then((f) => {
        if (!alive) return;
        const kept = recallBuffer(f.path);
        setUiFile(kept == null ? f : { ...f, content: kept });
        setSavedUi(f.content);
        setUi(readUiFile(kept ?? f.content));
        setParsable(!hasMalformedUiFile(kept ?? f.content));
      })
      .catch(() => alive && setParsable(false));
    store
      .hints()
      .then((h) => alive && setHints(h))
      .catch(() => {}); // no hints ⇒ the bind list is empty, editing still works
    return () => {
      alive = false;
    };
  }, [path, store, reloadKey]);

  // The DSP source, its own effect so it lands the moment the type is typed — see docs/builder.md.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadKey` is a TRIGGER, not a value this body reads.
  useEffect(() => {
    if (!dspSourceName || !store.dspSource) return setDspFile(null);
    let alive = true;
    void store
      .dspSource(path, dspSourceName)
      .then((f) => {
        if (!alive) return;
        const kept = recallBuffer(f.path);
        setDspFile(kept == null ? f : { ...f, content: kept });
        setSavedDsp(f.content);
      })
      .catch(() => alive && setDspFile(null));
    return () => {
      alive = false;
    };
  }, [dspSourceName, path, store, reloadKey]);

  // The lcdscreen script, beside the panel it draws for; absent is a stub, like every sidecar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadKey` is a TRIGGER, not a value this body reads.
  useEffect(() => {
    if (!store.widgetsScript) return setScriptFile(null);
    let alive = true;
    void store
      .widgetsScript(path)
      .then((f) => {
        if (!alive) return;
        const kept = recallBuffer(f.path);
        setScriptFile(kept == null ? f : { ...f, content: kept });
        setSavedScript(f.content);
      })
      .catch(() => alive && setScriptFile(null));
    return () => {
      alive = false;
    };
  }, [path, store, reloadKey]);

  // A visual edit rewrites the PANEL file; the code pane is controlled by it, so switching to it shows the change.
  const onUiChange = useCallback((next: ModuleUI) => {
    setUi(next);
    setUiFile((f) => (f ? { ...f, content: writeUiFile(f.content, next) } : f));
    setParsable(true);
  }, []);

  // A code edit in the PANEL syncs the grid while it still parses, and greys it out rather than misreading it.
  const onPanelChange = useCallback((text: string) => {
    setUiFile((f) => {
      if (!f || f.content === text) return f;
      if (hasMalformedUiFile(text)) setParsable(false);
      else {
        setUi(readUiFile(text));
        setParsable(true);
      }
      return { ...f, content: text };
    });
  }, []);

  // A code edit in the DSP source: no grid, no dropdown — it is compiled by the loader, not read here.
  const onDspChange = useCallback((text: string) => {
    setDspFile((f) => {
      if (!f || f.content === text) return f;
      return { ...f, content: text };
    });
  }, []);

  // A code edit in the script: the preview recompiles it, nothing here reads it.
  const onScriptChange = useCallback((text: string) => {
    setScriptFile((f) =>
      !f || f.content === text ? f : { ...f, content: text },
    );
  }, []);

  // A code edit in the MODULE file touches no grid — the panel moved out of it.
  const onCodeChange = useCallback((text: string) => {
    setContent((c) => (c === text ? c : text));
  }, []);

  /** Four files, four autosaves, each written when IT is readable — see docs/builder.md. */
  const writeSidecar = useCallback(
    async (file: ModuleSidecarFile | null, set: SetSidecar, text: string) => {
      if (!file) return;
      // A sidecar saves in place wherever it is, shared library included: nothing redirects it.
      await store.write(file.path, text);
      set((f) => (f ? { ...f, exists: true } : f));
      setStatus(`saved ${file.path}`);
      onSaved();
    },
    [store, onSaved, setStatus],
  );

  // `enabled` rather than a null path, so a read-only pane reports about the file it is showing.
  const panelSave = useAutosave({
    path: uiFile?.path ?? null,
    enabled: !readOnly,
    manual: true,
    text: uiFile?.content ?? "",
    saved: savedUi,
    write: useCallback(
      async (text: string) => {
        await writeSidecar(uiFile, setUiFile, text);
        setSavedUi(text);
      },
      [uiFile, writeSidecar],
    ),
  });
  const dspSave = useAutosave({
    path: dspFile?.path ?? null,
    enabled: !readOnly,
    manual: true,
    text: dspFile?.content ?? "",
    saved: savedDsp,
    write: useCallback(
      async (text: string) => {
        await writeSidecar(dspFile, setDspFile, text);
        setSavedDsp(text);
      },
      [dspFile, writeSidecar],
    ),
  });
  const scriptSave = useAutosave({
    path: scriptFile?.path ?? null,
    enabled: !readOnly,
    manual: true,
    text: scriptFile?.content ?? "",
    saved: savedScript,
    write: useCallback(
      async (text: string) => {
        await writeSidecar(scriptFile, setScriptFile, text);
        setSavedScript(text);
      },
      [scriptFile, writeSidecar],
    ),
  });
  const moduleSave = useAutosave({
    path: content == null ? null : path,
    enabled: !readOnly,
    manual: true,
    text: content ?? "",
    saved: savedModule,
    write: useCallback(
      async (text: string) => {
        // The module file CAN be redirected, and the HOST reopens — see docs/builder.md.
        const landed = await store.write(path, text);
        setSavedModule(text);
        onSaved();
        if (landed.path && landed.path !== path) {
          setStatus(landed.note ?? `saved ${landed.path}`);
          onRelocated?.(landed.path);
          return;
        }
        setStatus(`saved ${path}`);
      },
      [store, path, onSaved, onRelocated, setStatus],
    ),
  });

  // One badge for four files: the loudest thing any has to say, its tab already naming which.
  const saveState = loudest([moduleSave, panelSave, dspSave, scriptSave]);

  /** Save: write every dirty file, then publish them as ONE act — all four; see docs/builder.md. */
  const [publishing, setPublishing] = useState(false);
  const saveAll = useCallback(async () => {
    const landed = await Promise.all([
      moduleSave.flush(),
      panelSave.flush(),
      dspSave.flush(),
      scriptSave.flush(),
    ]);
    if (!landed.every(Boolean) || !store.publish) return;
    setPublishing(true);
    try {
      const { note } = await store.publish(path);
      if (note) setStatus(note);
    } catch (e) {
      setStatus(`saved, but not published — ${(e as Error).message}`);
    } finally {
      setPublishing(false);
    }
  }, [moduleSave, panelSave, dspSave, scriptSave, store, path, setStatus]);

  // What Save has to offer: any of the four differing from disk, derived and never a flag.
  const anyDirty = dirty || uiDirty || dspDirty || scriptDirty;
  // This screen is MANUAL, so nothing writes behind you: a reload here loses all four files at once.
  useUnsavedGuard(anyDirty);
  // …and the host hears it too, to ask before it swaps this module for another.
  useEffect(() => onDirtyChange?.(anyDirty), [anyDirty, onDirtyChange]);

  /** Leaving is the other way those four go, and the only one this screen can ask about. */
  const leave = useCallback(async () => {
    if (!anyDirty) return onBack();
    const agreed = await askConfirm({
      title: "Leave without saving?",
      body: "The module's files are changed here, and Save writes them together.",
      confirmLabel: "Quitter",
      danger: true,
    });
    if (agreed) onBack();
  }, [anyDirty, onBack]);

  /** Read every file again from disk — what an edit made OUTSIDE the builder needs; unsaved edits here are asked about first. */
  const refresh = useCallback(async () => {
    if (anyDirty) {
      const agreed = await askConfirm({
        title: "Reload from disk?",
        body: "The module's files are changed here. Reloading throws those changes away and shows the files as they are on disk now.",
        confirmLabel: "Reload",
        danger: true,
      });
      if (!agreed) return;
    }
    // A held edit outranks disk on load; a Refresh is the person choosing disk, so every one is dropped.
    for (const f of [path, uiFile?.path, dspFile?.path, scriptFile?.path])
      if (f) dropBuffer(f);
    setReloadKey((k) => k + 1);
    setStatus("module files reloaded from disk");
  }, [anyDirty, path, uiFile, dspFile, scriptFile, setStatus]);

  return {
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
  };
}
