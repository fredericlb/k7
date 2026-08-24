// ModuleBuilder.tsx — the full-screen module editor: a file's text on the LEFT, a visual grid
// of the module's widgets on the RIGHT. TWO files, one screen — `module.yaml` says what the
// module is, `ui.yaml` beside it says how it's drawn — and the grid always edits the second,
// rewriting it in place so typing flows the other way whenever it still parses (the grid greys
// out when it doesn't). Everything file-shaped goes through the injected ModuleStore.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Input } from "@frediverse/ui/input";
import { cn } from "@frediverse/ui/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import type { ParamMeta } from "@studio/engine-protocol";
import {
  FAUST_FILE,
  FAUST_TYPE,
  JSDSP_FILE,
  JSDSP_TYPE,
} from "@studio/engine-protocol/build";
import {
  builtinPluginFor,
  builtinPluginForRef,
} from "@studio/song-schema/builtinParams";
import {
  FILE_PARAMS,
  MODULE_STATUSES,
  type ModuleStatus,
} from "@studio/song-schema/moduleTypes";
import { loudest, recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import type {
  Hints,
  ModulePresetsFile,
  ModuleUiFile,
  PresetInfo,
} from "@studio/web-protocol";
import {
  AppWindow,
  ArrowLeft,
  Camera,
  ChevronDown,
  Folder,
  LayoutGrid,
  Loader2,
  Lock,
  type LucideIcon,
  Pencil,
  RefreshCw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { InputChannelBar } from "./InputChannelBar";
import {
  applyPresetToText,
  channelOf,
  extendsRefOf,
  hasMalformedPresets,
  hasMalformedUiFile,
  ioOf,
  type ModuleUI,
  readParams,
  readPlugin,
  readPresetsFile,
  readUiFile,
  setChannelIn,
  setStatusIn,
  statusOf,
  writeUiFile,
} from "./moduleUi";
import { setParamDrag } from "./paramDrag";
import type { ModuleStore } from "./store";
import { WidgetGridEditor } from "./WidgetGridEditor";
import { YamlPane } from "./YamlPane";

/** What the left column shows; `params` is the odd entry, being a list rather than a file — docs/builder.md. */

/** What each `status:` is CALLED on screen — a label, not a second spelling; packages/song/docs/moduleStatus.md. */
const STATUS_LABEL: Record<ModuleStatus, string> = {
  listed: "listed",
  favorite: "first",
  hidden: "hidden",
};

export type BuilderPane = "module" | "panel" | "presets" | "dsp" | "params";

/** The DSP source a plugin type implies — ONE table, since the tab, the fetch and the stub must agree. */
const DSP_SOURCE: Record<string, string> = {
  [JSDSP_TYPE]: JSDSP_FILE,
  [FAUST_TYPE]: FAUST_FILE,
};

/** The `plugin.type` off the RAW text: a regex, because mid-edit the document routinely does not parse. */
export function pluginTypeOf(text: string): string {
  const block = /^plugin:\s*(?:\n(?:[ \t]+.*\n?)*)/m.exec(text)?.[0] ?? "";
  return (
    /^[ \t]+type:\s*["']?([\w-]+)["']?/m.exec(block)?.[1] ??
    /^plugin:\s*\{[^}]*\btype:\s*["']?([\w-]+)["']?/m.exec(text)?.[1] ??
    ""
  );
}

/** A path's last segment — the tabs are named by their file, so this is what names them. */
const baseName = (p: string | undefined): string | undefined =>
  p?.split(/[\\/]/).pop() || undefined;

// What the two sidecars are called before one has been read, so a tab is never blank.
const UI_BASENAME = "ui.yaml";
const PRESETS_BASENAME = "presets.yaml";

// What the header says BESIDE the Save button; "clean" and "pending" say nothing — see docs/builder.md.
const SAVE_LABEL: Record<string, string> = {
  clean: "",
  pending: "",
  saving: "saving…",
  held: "not saved",
  error: "save failed",
};

// The preset menu's sections in display order, each with the icon for its source: program bank, OS file.
const PRESET_GROUPS: {
  source: PresetInfo["source"];
  label: string;
  Icon: LucideIcon;
}[] = [
  { source: "program", label: "Programs", Icon: LayoutGrid },
  { source: "file", label: "Factory presets", Icon: Folder },
];

export function ModuleBuilder({
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
  }) => ReactNode;
}) {
  const [content, setContent] = useState<string | null>(null);
  /** The module's `status:` off the BUFFER, so the dropdown shows the edit you just made — docs/builder.md. */
  const moduleStatus = useMemo(() => statusOf(content ?? ""), [content]);
  const [ui, setUi] = useState<ModuleUI | null>(null);
  const [parsable, setParsable] = useState(true);
  const [hints, setHints] = useState<Hints | null>(null);
  // What is on disk, one string per file: every "dirty" is DERIVED from it, never a flag — docs/builder.md.
  const [savedModule, setSavedModule] = useState("");
  const [savedUi, setSavedUi] = useState("");
  const [savedPresets, setSavedPresets] = useState("");
  const [savedDsp, setSavedDsp] = useState("");
  const dirty = content != null && content !== savedModule;
  // The `ui.yaml` beside the module file, which is what the grid edits; it may not exist yet — docs/builder.md.
  const [uiFile, setUiFile] = useState<ModuleUiFile | null>(null);
  const uiDirty = !!uiFile && uiFile.content !== savedUi;
  // …and the third file, the named settings — read as a FILE because you type into it as readily as you click.
  const [presetFile, setPresetFile] = useState<ModulePresetsFile | null>(null);
  const presetsDirty = !!presetFile && presetFile.content !== savedPresets;
  // …and the fourth, which only a jsdsp module has: its own DSP source, fetched only when it claims one.
  const [dspFile, setDspFile] = useState<ModulePresetsFile | null>(null);
  const dspDirty = !!dspFile && dspFile.content !== savedDsp;
  // Which file the CODE pane shows; the PANEL opens first, being what the grid beside it edits.
  const [pane, setPane] = useState<BuilderPane>(initialPane ?? "panel");
  const [error, setError] = useState<string | null>(null);
  // Factory presets need a live plugin instance, so ask only when editing the module itself.
  useEffect(() => {
    if (kind === "module") onListPresets(moduleName);
  }, [kind, moduleName, onListPresets]);

  // Which sidecar the pane is on, as ONE expression: three places ask this, and three answers drift.
  const sidecar =
    pane === "panel"
      ? uiFile
      : pane === "presets"
        ? presetFile
        : pane === "dsp"
          ? dspFile
          : null;

  // Whether the DSP is the module's own source and in which language, read off the BUFFER so the tab lands at once.
  const dspSourceName = useMemo(
    () =>
      content == null ? null : (DSP_SOURCE[pluginTypeOf(content)] ?? null),
    [content],
  );

  // The module's OWN presets, off its shelf. A name and the values it sets — nothing else is recorded.
  const shelf = useMemo(
    () => (presetFile ? readPresetsFile(presetFile.content) : {}),
    [presetFile],
  );

  /** Apply a shelf preset by stamping its values into the module BUFFER — an EDIT; see docs/builder.md. */
  const applyShelfPreset = useCallback(
    (name: string) => {
      const values = shelf[name];
      // Read-only: stamping values into a buffer nothing will write is how you lose an afternoon.
      if (readOnly || !values || content == null) return;
      setContent(applyPresetToText(content, values));
      setStatus(`preset: ${name}`);
    },
    [readOnly, shelf, content, setStatus],
  );

  // Empty while read-only, every entry being an edit; the plugin's own banks stay, since those load into it.
  const shelfNames = readOnly ? [] : Object.keys(shelf);

  /** Apply a FACTORY preset — the plugin's own, which only a live plugin can load. */
  const applyPreset = useCallback(
    (p: PresetInfo) => {
      onSetPreset(moduleName, { index: p.index, path: p.path });
      setStatus(`preset: ${p.name}`);
    },
    [moduleName, onSetPreset, setStatus],
  );

  // Load the file and the project's hints once, for this path.
  useEffect(() => {
    let alive = true;
    setContent(null);
    setUiFile(null);
    setPresetFile(null);
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
    // The shelf, allowed to fail for the same reason: a file that isn't a module still opens for its text.
    store
      .presets(path)
      .then((f) => {
        if (!alive) return;
        const kept = recallBuffer(f.path);
        setPresetFile(kept == null ? f : { ...f, content: kept });
        setSavedPresets(f.content);
      })
      .catch(() => alive && setPresetFile(null));
    store
      .hints()
      .then((h) => alive && setHints(h))
      .catch(() => {}); // no hints ⇒ the bind list is empty, editing still works
    return () => {
      alive = false;
    };
  }, [path, store]);

  // The DSP source, its own effect so it lands the moment the type is typed — see docs/builder.md.
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
  }, [dspSourceName, path, store]);

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

  // A code edit in the SHELF: no grid to sync, only the dropdown, which reads it fresh each render.
  const onPresetsChange = useCallback((text: string) => {
    setPresetFile((f) =>
      !f || f.content === text ? f : { ...f, content: text },
    );
  }, []);

  // A code edit in the DSP source: no grid, no dropdown — it is compiled by the loader, not read here.
  const onDspChange = useCallback((text: string) => {
    setDspFile((f) => {
      if (!f || f.content === text) return f;
      return { ...f, content: text };
    });
  }, []);

  // A code edit in the MODULE file touches no grid — the panel moved out of it.
  const onCodeChange = useCallback((text: string) => {
    setContent((c) => (c === text ? c : text));
  }, []);

  /** Four files, four autosaves, each written when IT is readable — see docs/builder.md. */
  const writeSidecar = useCallback(
    async (
      file: ModulePresetsFile | null,
      set: (
        f: (p: ModulePresetsFile | null) => ModulePresetsFile | null,
      ) => void,
      text: string,
    ) => {
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
  const presetsSave = useAutosave({
    path: presetFile?.path ?? null,
    enabled: !readOnly,
    manual: true,
    text: presetFile?.content ?? "",
    saved: savedPresets,
    write: useCallback(
      async (text: string) => {
        await writeSidecar(presetFile, setPresetFile, text);
        setSavedPresets(text);
      },
      [presetFile, writeSidecar],
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
  const saveState = loudest([moduleSave, panelSave, dspSave, presetsSave]);

  /** Save: write every dirty file, then publish them as ONE act — all four; see docs/builder.md. */
  const [publishing, setPublishing] = useState(false);
  const saveAll = useCallback(async () => {
    const landed = await Promise.all([
      moduleSave.flush(),
      panelSave.flush(),
      dspSave.flush(),
      presetsSave.flush(),
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
  }, [moduleSave, panelSave, dspSave, presetsSave, store, path, setStatus]);
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

  // What Save has to offer: any of the four differing from disk, derived and never a flag.
  const anyDirty = dirty || uiDirty || presetsDirty || dspDirty;

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

  const params = paramRef ? (hints?.paramsByBase[paramRef] ?? []) : [];
  // Ranges for a built-in st0 defines; the engine's live report is better, so this only fills what it has not.
  const baseMeta = paramRef ? (hints?.paramMetaByBase[paramRef] ?? {}) : {};

  /** …and the built-in the file itself names, the source that needs NO project — see docs/builder.md. */
  const declared = useMemo(() => {
    if (content == null) return undefined;
    return (
      builtinPluginFor(readPlugin(content)) ??
      builtinPluginForRef(extendsRefOf(content))
    )?.params;
  }, [content]);

  // What KIND of module this is, the PATH counting too: one under `io/IN/` is an input whatever it says.
  const io = content == null ? null : ioOf(content, path);

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
            ? "cette machine n'arrive pas à charger ce greffon — le journal du moteur dit lequel des deux : introuvable, ou création refusée. C'est une licence ou une installation, pas le greffon."
            : found.names.length
              ? `${found.names.length} paramètres lus dans le greffon`
              : "le greffon se charge et ne publie aucun paramètre à son hôte",
        );
      })
      .catch((e: Error) => setScanNote(`lecture impossible : ${e.message}`))
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
          "fenêtre du greffon ouverte sur la machine du moteur — c'est une instance à part, rien de ce qu'on y touche n'est enregistré",
        ),
      )
      .catch((e: Error) => setScanNote(`ouverture impossible : ${e.message}`))
      .finally(() => setOpeningUi(false));
  }, [onShowNativeUI, openingUi, nativeUiBase]);

  /** The bases this module may be set to, asked of the HOST because the useful list is its ancestors' too. */
  const [bases, setBases] = useState<string[]>([]);
  const [basesKey, setBasesKey] = useState(0);
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
  }, [store, path, basesKey]);

  const [snapping, setSnapping] = useState(false);
  const snapBase = useCallback(() => {
    if (!store.snapshotBase || snapping || !nativeUiBase) return;
    const name = window.prompt(
      "Nom de la base — l'état actuel du greffon, gardé dans base/",
    );
    if (!name?.trim()) return;
    setSnapping(true);
    setScanNote(null);
    void store
      .snapshotBase(path, name.trim(), nativeUiBase)
      .then((w) => {
        setScanNote(`base gardée : ${w.path}`);
        setBasesKey((k) => k + 1); // it is bindable now, so the row has to know about it
      })
      // The message is the HOST's: only the side that asked the engine knows what failed.
      .catch((e: Error) => setScanNote(`base impossible : ${e.message}`))
      .finally(() => setSnapping(false));
  }, [store, snapping, nativeUiBase, path]);

  // Every addressable param, unioned from all FIVE sources — none of them is complete on its own.
  const paramRows = useMemo(() => {
    const set = content == null ? {} : readParams(content);
    const bound = new Set(
      Object.values(ui?.widgets ?? {})
        .map((w) => w.bind)
        .filter(Boolean) as string[],
    );
    // An io module's own settings, offered only on an io module: on a plugin they would name nothing.
    const ioBinds = io === "in" ? IO_IN_BINDS : [];
    /** `@base`, offered only where there ARE bases; the graph fills its entries — see docs/builder.md. */
    const baseBinds: { name: string; meta: ParamMeta }[] = bases.length
      ? [
          {
            name: "@base",
            meta: {
              min: 0,
              max: bases.length,
              states: [
                { label: "none", value: 0 },
                ...bases.map((b, i) => ({ label: b, value: i + 1 })),
              ],
            },
          },
        ]
      : [];
    const names = new Set([
      ...Object.keys(set),
      ...(pluginParamNames ?? []),
      // …and what a SCAN asked for on purpose: the same plugin, without needing an instance first.
      ...(scanned?.names ?? []),
      ...params,
      ...(declared ?? []).map((p) => p.name),
      // Track intrinsics belong here too: this list is the only place a binding can be picked up from.
      ...TRACK_BINDS,
      ...ioBinds.map((b) => b.name),
      ...baseBinds.map((b) => b.name),
    ]);
    // The io binds bring their OWN ranges, and so does `@base`, whose range is a list of names.
    const ioMeta = Object.fromEntries(
      [...ioBinds, ...baseBinds].map((b) => [b.name, b.meta]),
    );
    // …and the declared built-in's, the only range a module in a LIBRARY will ever have.
    const declaredMeta = Object.fromEntries(
      (declared ?? []).map((p) => [
        p.name,
        { min: p.min, max: p.max, def: p.def },
      ]),
    );
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({
        name,
        // The authored value lives at the file's TOP level for an io setting, not under `params:`.
        value: set[name] ?? authoredIoValue(content, name),
        bound: bound.has(name),
        // Most specific first — loaded, scanned, declared, base, io; see docs/builder.md.
        meta:
          pluginParamMeta?.[name] ??
          scanned?.meta[name] ??
          declaredMeta[name] ??
          baseMeta[name] ??
          ioMeta[name],
      }));
  }, [
    content,
    io,
    ui,
    params,
    declared,
    baseMeta,
    pluginParamNames,
    pluginParamMeta,
    scanned,
    bases,
  ]);

  // The same values as NUMBERS for the preview; anything that is not one falls back to the widget's min.
  const paramValues = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [name, raw] of Object.entries(
      content == null ? {} : readParams(content),
    )) {
      const n = Number(raw);
      if (Number.isFinite(n)) out[name] = n;
    }
    return out;
  }, [content]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            Module editor — {kind === "base" ? "base module" : "module"} ·{" "}
            {moduleName}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {path}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* The plugin's factory presets, with no "save as preset": a module's parameters ARE its file. */}
          {(presets.length > 0 || shelfNames.length > 0) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  title="the plugin's factory presets"
                >
                  <SlidersHorizontal className="mr-1 h-4 w-4" /> Preset
                  <ChevronDown className="ml-1 h-4 w-4 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-[70vh] w-56 overflow-y-auto"
              >
                {/* The module's OWN shelf first: it is the one that works with no engine attached. */}
                {shelfNames.length > 0 && (
                  <div>
                    <DropdownMenuLabel>This module</DropdownMenuLabel>
                    {shelfNames.map((name) => (
                      <DropdownMenuItem
                        key={`shelf-${name}`}
                        onSelect={() => applyShelfPreset(name)}
                      >
                        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{name}</span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                )}
                {PRESET_GROUPS.map(({ source, label, Icon }) => {
                  const items = presets.filter((p) => p.source === source);
                  if (!items.length) return null;
                  return (
                    <div key={source}>
                      <DropdownMenuLabel>{label}</DropdownMenuLabel>
                      {items.map((p, i) => (
                        <DropdownMenuItem
                          key={`${source}-${i}`}
                          onSelect={() => applyPreset(p)}
                        >
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate">{p.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </div>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* How the COMPLETIONS treat this module, in the header beside its name — ../docs/builder.md. */}
          {readOnly ? (
            moduleStatus !== "listed" && (
              <span className="text-xs text-muted-foreground">
                {STATUS_LABEL[moduleStatus]}
              </span>
            )
          ) : (
            <Select
              value={moduleStatus}
              onValueChange={(v) =>
                setContent((c) => setStatusIn(c ?? "", v as ModuleStatus))
              }
            >
              <SelectTrigger
                size="sm"
                className="w-[7.5rem]"
                title="how the completions treat this module — listed, first, or not at all"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODULE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Read-only says so where the save badge would be, and the button beside it only ASKS the host. */}
          {readOnly && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              read-only
            </span>
          )}
          {readOnly && onRequestEdit && (
            <Button variant="secondary" size="sm" onClick={onRequestEdit}>
              <Pencil className="mr-1 h-4 w-4" /> Edit
            </Button>
          )}
          {/* A button and not a timer, because on a shared module a save is a publish — ../docs/builder.md. */}
          {!readOnly && (
            <Button
              size="sm"
              onClick={() => void saveAll()}
              disabled={
                !anyDirty || publishing || saveState.status === "saving"
              }
              title="save the module's files — Ctrl+S"
            >
              {publishing || saveState.status === "saving" ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save
            </Button>
          )}
          {/* Beside it, what the files say: nothing when on disk, amber with the reason when one is held. */}
          <span
            className={cn(
              "flex min-w-0 items-center gap-1 text-xs",
              saveState.status === "held" || saveState.status === "error"
                ? "text-amber-500"
                : "text-muted-foreground",
            )}
            title={saveState.reason ?? undefined}
          >
            {saveState.status === "saving" && (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            )}
            <span className="truncate">
              {SAVE_LABEL[saveState.status]}
              {(saveState.status === "held" || saveState.status === "error") &&
              saveState.reason
                ? ` — ${saveState.reason}`
                : ""}
            </span>
          </span>
        </div>
      </header>

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
          {/* Left column: what the file SAYS on top, what the module HAS underneath. */}
          <div className="flex min-h-0 w-1/2 shrink-0 flex-col border-r border-border">
            {/* Three files, one pane, so it says which of them you are typing into. */}
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
              {/* Each tab is named by its FILE: they are three files on disk, not three views of one. */}
              {(
                [
                  ["module", baseName(path), dirty, true, null],
                  [
                    "panel",
                    baseName(uiFile?.path) ?? UI_BASENAME,
                    uiDirty,
                    !!uiFile,
                    uiFile ? null : "not read yet",
                  ],
                  // Only for a module that HAS one: an always-there, usually dead tab would mislead.
                  ...(dspSourceName
                    ? ([
                        [
                          "dsp",
                          baseName(dspFile?.path) ?? dspSourceName,
                          dspDirty,
                          !!dspFile,
                          dspFile
                            ? dspFile.exists
                              ? null
                              : "doesn't exist yet — saving creates it"
                            : "this host does not serve it",
                        ],
                      ] as const)
                    : []),
                  // Not a file, and last for that reason — see BuilderPane.
                  ["params", "parameters", false, true, null],
                  [
                    "presets",
                    baseName(presetFile?.path) ?? PRESETS_BASENAME,
                    presetsDirty,
                    !!presetFile,
                    // A shelf the schema refuses is SAID so, on the tab itself — see docs/builder.md.
                    presetFile && hasMalformedPresets(presetFile.content)
                      ? "malformed"
                      : presetFile?.exists
                        ? null
                        : "doesn't exist yet — saving creates it",
                  ],
                ] as const
              ).map(([id, label, isDirty, ready, note]) => (
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
                  {note === "malformed" ? (
                    <span className="ml-1 text-amber-400">!</span>
                  ) : null}
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
                      ? snapBase
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
                      : pane === "presets"
                        ? onPresetsChange
                        : pane === "dsp"
                          ? onDspChange
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
          </div>
          {/* Right column: the panel's geometry above, and below at 30% the node it becomes. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <WidgetGridEditor
                ui={ui}
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
                onChange={onUiChange}
              />
            </div>
            {renderPreview && (
              <div className="h-[30%] min-h-0 shrink-0 grow-0 border-t border-border">
                {renderPreview({ ui, params: paramValues, bases })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Track intrinsics a widget can bind besides plugin params — on a track node the graph routes these to the mixer.
const TRACK_BINDS = ["@volume", "@pan", "@mute", "@solo", "@arm"];

// What an `io: in` module binds instead, namespaced like the track intrinsics — see docs/builder.md.
const IO_IN_BINDS: { name: string; meta: ParamMeta }[] = [
  // ±24 dB: a judgement about what is useful, since Tracktion does not clamp this one.
  { name: "@gain", meta: { min: -24, max: 24 } },
  // A DROPDOWN, not a toggle: monitoring is three-state and "auto" is neither on nor off.
  {
    name: "@monitor",
    meta: {
      min: 0,
      max: 2,
      states: [
        { label: "off", value: 0 },
        { label: "auto", value: 1 },
        { label: "on", value: 2 },
      ],
    },
  },
];

// What the FILE says an io setting is: a TOP-LEVEL field, which readParams cannot see.
function authoredIoValue(
  content: string | null,
  bind: string,
): string | undefined {
  if (content == null || !bind.startsWith("@")) return undefined;
  const m = new RegExp(`^${bind.slice(1)}:[ \\t]*(\\S+)[ \\t]*$`, "m").exec(
    content,
  );
  return m?.[1];
}

// A long float is noise in a ~90px row; the untruncated value stays in the row's tooltip.
function shortValue(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) && /^-?[\d.]+$/.test(raw.trim())
    ? String(Math.round(n * 1e4) / 1e4)
    : raw;
}

// The parameters, read-only and filtered on purpose — see docs/builder.md.
function ParamsPane({
  rows,
  onScan,
  scanning,
  scanNote,
  onNativeUi,
  openingUi,
  onSnapshotBase,
  snapping,
}: {
  rows: {
    name: string;
    value?: string;
    bound: boolean;
    meta?: ParamMeta;
  }[];
  /** Absent ⇒ no button: a host with no engine cannot ask, and a dead control is worse than none. */
  onScan?: () => void;
  scanning?: boolean;
  /** What the last scan OR window-open answered: the empty and refused cases have no rows to show. */
  scanNote?: string | null;
  /** Absent ⇒ no button: no engine to ask, or a built-in, which draws no window. */
  onNativeUi?: () => void;
  openingUi?: boolean;
  /** Absent ⇒ no button; a base is a WRITE into the module's folder, so it follows the text's lock. */
  onSnapshotBase?: () => void;
  snapping?: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) => r.name.toLowerCase().includes(needle))
    : rows;

  return (
    // A pane filling the column, with no border-t: nothing is above it to be separated from.
    <div className="flex h-full min-h-0 flex-col bg-card/30">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="hidden text-[10px] text-muted-foreground sm:inline">
          drag onto a widget, or onto empty grid
        </span>
        <span className="text-xs text-muted-foreground">
          {needle ? `${shown.length}/${rows.length}` : rows.length}
        </span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter…"
          className="ml-auto h-6 w-32 px-2 text-xs"
        />
        {/* With the LIST and not in the header, since what it changes is this pane and not the module. */}
        {onScan && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={scanning}
            onClick={onScan}
            title="Load this module's plugin and read its parameters — takes a few seconds"
          >
            {scanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1 hidden sm:inline">
              {scanning ? "lecture…" : "greffon"}
            </span>
          </Button>
        )}
        {/* Beside the scan and not instead of it: the two ask the same binary for different things. */}
        {onNativeUi && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={openingUi}
            onClick={onNativeUi}
            title="Open the plugin's own window — a separate instance, on the engine's machine. Nothing touched in it is saved."
          >
            {openingUi ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <AppWindow className="h-3.5 w-3.5" />
            )}
            <span className="ml-1 hidden sm:inline">
              {openingUi ? "ouverture…" : "Native UI"}
            </span>
          </Button>
        )}
        {/* Next to the window it reads from, and gone on a read-only module since it writes a file. */}
        {onSnapshotBase && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={snapping}
            onClick={onSnapshotBase}
            title="Keep the plugin's current state as a named base in the module's base/ folder — for plugins whose sound is not in their parameters"
          >
            {snapping ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            <span className="ml-1 hidden sm:inline">
              {snapping ? "capture…" : "Snapshot a base"}
            </span>
          </Button>
        )}
      </div>
      {scanNote && (
        <div className="shrink-0 border-b border-border px-2 py-1 text-[11px] text-muted-foreground">
          {scanNote}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">
            {rows.length === 0
              ? onScan
                ? "no parameters known — the project instantiates no plugin for this module. Ask the plugin itself with the button above."
                : "no parameters known — the module sets none, and the engine has no live plugin to ask"
              : `nothing matches "${q.trim()}"`}
          </div>
        ) : (
          shown.map((r) => (
            <div
              key={r.name}
              // Dragging a row onto a widget is what binds it (paramDrag.ts); the range rides along with the name.
              draggable
              onDragStart={(e) =>
                setParamDrag(e.dataTransfer, { name: r.name, meta: r.meta })
              }
              title={[
                r.value === undefined ? r.name : `${r.name} = ${r.value}`,
                r.meta?.states?.length
                  ? `settings: ${r.meta.states.map((s) => s.label).join(", ")}`
                  : r.meta && `range ${r.meta.min}…${r.meta.max}`,
                r.meta?.def !== undefined && `default ${r.meta.def}`,
              ]
                .filter(Boolean)
                .join("\n")}
              className="flex cursor-grab items-baseline gap-2 px-2 py-0.5 font-mono text-xs odd:bg-muted/20 hover:bg-accent/40 active:cursor-grabbing"
            >
              {/* Dimmed when the file leaves the param at the plugin's own value. */}
              <span
                className={`min-w-0 flex-1 truncate ${r.value === undefined ? "text-muted-foreground" : "text-foreground"}`}
              >
                {r.name}
              </span>
              {/* What the parameter spans, which is the number a knob has to be given. */}
              {/* A discrete one shows its setting count instead: that is the cue it makes a dropdown. */}
              {r.meta?.states?.length ? (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                  {r.meta.states.length} settings
                </span>
              ) : r.meta ? (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                  {r.meta.min}…{r.meta.max}
                </span>
              ) : null}
              {r.bound && (
                <span
                  title="bound to a widget in the UI grid"
                  className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  ui
                </span>
              )}
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.value === undefined ? "—" : shortValue(r.value)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Nothing resolves a pick: the catalogue carries the file and both refs — see docs/builder.md.
