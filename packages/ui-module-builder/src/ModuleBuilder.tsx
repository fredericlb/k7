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
import type { ParamMeta } from "@studio/engine-protocol";
import { JSDSP_FILE, JSDSP_TYPE } from "@studio/engine-protocol/build";
import { FILE_PARAMS } from "@studio/song/moduleTypes";
import { loudest, recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import type {
  Hints,
  ModulePresetsFile,
  ModuleUiFile,
  PresetInfo,
} from "@studio/web-protocol";
import {
  ArrowLeft,
  ChevronDown,
  Folder,
  LayoutGrid,
  Loader2,
  Lock,
  type LucideIcon,
  Pencil,
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
import {
  applyPresetToText,
  hasMalformedPresets,
  hasMalformedUiFile,
  ioOf,
  type ModuleUI,
  readParams,
  readPresetsFile,
  readUiFile,
  writeUiFile,
} from "./moduleUi";
import { setParamDrag } from "./paramDrag";
import type { ModuleStore } from "./store";
import { WidgetGridEditor } from "./WidgetGridEditor";
import { YamlPane } from "./YamlPane";

/** Which of the module's three files the code pane is showing. Named for the BUILDER, not just `Pane`:
 *  l8 has panes of its own and a shared package must not squat the word. */
export type BuilderPane = "module" | "panel" | "presets" | "jsdsp";

/**
 * The `plugin.type` a module file declares, read off the raw text.
 *
 * A regex and not the YAML parser: this runs on every keystroke in the code pane, and the answer
 * decides whether a tab is drawn. Mid-edit the document routinely does not parse, and a tab that
 * blinked out on a half-typed line would be worse than one read a shade loosely.
 */
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

// What the two sidecars are called before one has been read, so a tab is never blank. The store
// answers with the path a file WOULD take, so these are only ever seen for the moment before it does.
const UI_BASENAME = "ui.yaml";
const PRESETS_BASENAME = "presets.yaml";

// What the header says BESIDE the Save button. "clean" says nothing: four files on disk is the
// ordinary state of this screen and does not need announcing — and "pending" says nothing
// either now, because the button being live already says it, in a place you can act on.
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
  // Which file the code pane opens on. The PANEL by default — it is what the grid beside it edits — but a
  // host that knows which of the three was clicked says so, and the click lands where it pointed.
  initialPane?: BuilderPane;
  /**
   * Show the module without editing it: the four files read, the grid frozen, no autosave armed.
   *
   * The state a SHARED module opens in. It is not a lesser builder — the params list, the
   * live plugin and the preview all work — it is the same screen with the writing turned
   * off, which is what makes "you are about to change something everyone uses" a decision
   * somebody takes rather than a thing that happens while they look around.
   */
  readOnly?: boolean;
  /**
   * The button that asks to be let in, drawn only when there IS one — a host that never
   * unlocks passes nothing and gets a plainly read-only screen.
   *
   * The host answers by flipping `readOnly`, and whatever it wants to say first (a warning,
   * a confirmation) is its own: a shared package knows this module is not the project's, and
   * cannot know whose it is or what writing to it costs. Same argument as `renderPreview`.
   */
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
  // Refs this module may `extends`, when the STORE cannot say. Which plugins a machine has
  // scanned is a question only that machine's engine answers, over its socket — l8's backend
  // reads the same cache off disk and puts it in `hints`, the médiathèque's has no such disk.
  // A prop for exactly the reason `pluginParamNames` is one.
  baseModules?: string[];
  // A save the host redirected — l8 forks a shared module rather than writing into it, so the
  // file being edited moves. The host reopens; this component does not follow paths on its own.
  onRelocated?: (path: string) => void;
  // What fills the box UNDER the grid — the module drawn as the graph node it will be in a chain.
  // This component owns the box and its height; the host owns what goes in it, because the graph
  // renderer needs the app's own icons and command line and a shared package cannot invent either
  // (see @studio/ui-chains-react/docs/hosting.md). Absent ⇒ the grid keeps the whole column.
  renderPreview?: (view: {
    ui: ModuleUI;
    params: Record<string, number>;
  }) => ReactNode;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [ui, setUi] = useState<ModuleUI | null>(null);
  const [parsable, setParsable] = useState(true);
  const [hints, setHints] = useState<Hints | null>(null);
  // What is on disk, one string per file. Every "dirty" below is derived from it and the
  // buffer rather than being a flag of its own: four flags and four buffers is four chances
  // for the screen to disagree with the disk, and autosave writes far too often for that.
  const [savedModule, setSavedModule] = useState("");
  const [savedUi, setSavedUi] = useState("");
  const [savedPresets, setSavedPresets] = useState("");
  const [savedDsp, setSavedDsp] = useState("");
  const dirty = content != null && content !== savedModule;
  // The module's panel is the `ui.yaml` beside its module file (see uiLibrary.ts), which is what the grid
  // edits. It may not exist yet — the server answers with the path it WOULD take and a blank grid, so the
  // first save creates it through the ordinary write route.
  const [uiFile, setUiFile] = useState<ModuleUiFile | null>(null);
  const uiDirty = !!uiFile && uiFile.content !== savedUi;
  // …and the third file, the module's named settings. Read as a FILE like the other two, not fetched as a
  // list, because it is one you type into as readily as you click (see moduleUi.ts).
  const [presetFile, setPresetFile] = useState<ModulePresetsFile | null>(null);
  const presetsDirty = !!presetFile && presetFile.content !== savedPresets;
  // …and the fourth, which only a `plugin: {type: jsdsp}` module has: its own DSP source. Not
  // YAML — the pane below highlights it as such — and fetched only when the module claims one,
  // so an ordinary module never asks its host for a file that is not there.
  const [dspFile, setDspFile] = useState<ModulePresetsFile | null>(null);
  const dspDirty = !!dspFile && dspFile.content !== savedDsp;
  // Which file the CODE pane shows. Three files, one pane: what the module IS, how it is drawn, and its named
  // settings. The PANEL opens first — it is what the grid beside it edits, and what people come to this screen
  // for. The other two are a tab away.
  const [pane, setPane] = useState<BuilderPane>(initialPane ?? "panel");
  const [error, setError] = useState<string | null>(null);
  // Factory presets need a live plugin instance, so ask only when editing the module itself.
  useEffect(() => {
    if (kind === "module") onListPresets(moduleName);
  }, [kind, moduleName, onListPresets]);

  // Which of the three sidecars the pane is on, or null when it is on the module file itself. One expression,
  // because three places downstream ask the same question and answering it three times is how they drift.
  const sidecar =
    pane === "panel"
      ? uiFile
      : pane === "presets"
        ? presetFile
        : pane === "jsdsp"
          ? dspFile
          : null;

  // Does this module's DSP come from its own source? The TYPE says so, and the file is
  // `jsdsp.ts` beside it — one statement, read straight off the buffer being edited so the tab
  // appears the moment the type is typed rather than after a save.
  const isJsDsp = useMemo(
    () => (content == null ? false : pluginTypeOf(content) === JSDSP_TYPE),
    [content],
  );

  // The module's OWN presets, off its shelf. A name and the values it sets — nothing else is recorded.
  const shelf = useMemo(
    () => (presetFile ? readPresetsFile(presetFile.content) : {}),
    [presetFile],
  );

  /**
   * Apply a preset from the shelf: stamp its values into the module BUFFER.
   *
   * An edit and nothing more — no state to push, no engine to ask. It is written like any other
   * edit, so trying four presets in a row writes four times; Ctrl+Z in the code pane takes each
   * one back, and l8's journal has them all. It used to be undone by simply not saving, which
   * was an affordance of the button and went with it.
   */
  const applyShelfPreset = useCallback(
    (name: string) => {
      const values = shelf[name];
      // Read-only: this one is an EDIT, unlike a factory preset, which loads into the plugin.
      // Stamping values into a buffer nothing will write is how you lose an afternoon.
      if (readOnly || !values || content == null) return;
      setContent(applyPresetToText(content, values));
      setStatus(`preset: ${name}`);
    },
    [readOnly, shelf, content, setStatus],
  );

  // The shelf as the dropdown offers it — empty while the screen is read-only, since every one
  // of its entries is an edit. The plugin's own banks stay: those load into the plugin.
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
    // The panel is fetched separately and is allowed to fail: a file that isn't a module (a base being edited
    // by path, say) still opens for its text — the grid is just disabled.
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

  // The DSP source, fetched only once the module says it HAS one. Its own effect rather than a
  // fourth call in the one above: `isJsDsp` is read off the buffer, so it becomes true the moment
  // someone types the type — and an ordinary module never asks a host for a file that is not there.
  useEffect(() => {
    if (!isJsDsp || !store.jsdsp) return setDspFile(null);
    let alive = true;
    void store
      .jsdsp(path)
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
  }, [isJsDsp, path, store]);

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

  /**
   * Four files, four autosaves — not one save that walks them in order.
   *
   * They are four documents on disk with four schemas, and the whole point of the rule is that a
   * file is written when IT is readable: a half-typed widget in the panel must not stop the
   * module file being saved, which is exactly what a single button that wrote them in sequence
   * did. Each one holds its own text back and says so on its own tab.
   */
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

  // `enabled` rather than a null path on all four: the hook still knows which file it is about,
  // so a read-only pane reports "clean" about the file it is showing instead of about nothing.
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
        // The module file CAN be redirected: l8 copies a shared module into the project rather
        // than writing into the library. The host is told and reopens — following the new path
        // from here would leave the engine link and the title pointing at the module that was
        // not edited.
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

  // One badge for four files: the loudest thing any of them has to say. Which file it is about
  // is on its tab, where the name already is.
  const saveState = loudest([moduleSave, panelSave, dspSave, presetsSave]);

  /**
   * Save: write every dirty file, then publish them as ONE act.
   *
   * All four and not the pane on screen, which is what Ctrl+S used to mean here. A module is
   * four files that describe one thing, and saving the one you happen to be looking at leaves
   * the other three behind — which on a shared module means publishing a panel for a plugin
   * nobody else has yet. They are edited together, so they land together.
   *
   * `publish` runs only if every one of them landed. `flush` answers that: a file held back
   * because it would not compile reports false, and committing a module whose `module.yaml` is
   * still yesterday's would put a half-edit in front of everybody.
   */
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

  // What Save has to offer: any of the four differing from disk. Derived, never a flag —
  // the same rule the rest of this screen follows.
  const anyDirty = dirty || uiDirty || presetsDirty || dspDirty;

  /**
   * The hints the code pane completes against: the store's, plus whatever the host learnt
   * from a live engine.
   *
   * Merged rather than substituted — a project's own base modules are real vocabulary too,
   * and the two sources answer for different halves of what `extends:` may name. Deduped,
   * since a project that has already scanned holds some of the same refs.
   */
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
  // Ranges for a built-in whose params l8 defines (see builtinParams.ts). The engine's live report is
  // better when there is one — it comes from the loaded plugin — so this only fills what that has not.
  const baseMeta = paramRef ? (hints?.paramMetaByBase[paramRef] ?? {}) : {};

  // Every addressable param, unioned from all three sources — none of them is complete on its own.
  const paramRows = useMemo(() => {
    const set = content == null ? {} : readParams(content);
    const bound = new Set(
      Object.values(ui?.widgets ?? {})
        .map((w) => w.bind)
        .filter(Boolean) as string[],
    );
    // An io module's own settings, offered only on an io module: on a plugin they would name nothing.
    const io = content == null ? null : ioOf(content);
    const ioBinds = io === "in" ? IO_IN_BINDS : [];
    const names = new Set([
      ...Object.keys(set),
      ...(pluginParamNames ?? []),
      ...params,
      // Track intrinsics belong here too: this list is the only place a binding can be picked up from.
      ...TRACK_BINDS,
      ...ioBinds.map((b) => b.name),
    ]);
    // The io binds bring their OWN ranges — there is no plugin to have reported any.
    const ioMeta = Object.fromEntries(ioBinds.map((b) => [b.name, b.meta]));
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({
        name,
        // The authored value lives at the file's TOP level for an io setting, not under `params:`.
        value: set[name] ?? authoredIoValue(content, name),
        bound: bound.has(name),
        meta: pluginParamMeta?.[name] ?? baseMeta[name] ?? ioMeta[name],
      }));
  }, [content, ui, params, baseMeta, pluginParamNames, pluginParamMeta]);

  // The same values as NUMBERS, for the preview's widgets. The pane above keeps them as text
  // because a value is whatever the file says; a knob needs a position, so anything that isn't
  // a number is left out and the widget falls back to its own min.
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
          {/* The plugin's factory presets, from the engine. Applying one loads it without
              opening the plugin's own window. There is no "save as preset" here: a module's
              parameters ARE its file, and Save already writes them. */}
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
                {/* The module's OWN shelf first: it is the one a person here wrote, and the one that
                    works with no engine attached. The plugin's banks follow. */}
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
          {/* Read-only says so where the save badge would be, because it is the same
              question — what is happening to what you type. The button beside it is the
              host's, and asking is all it does: this component does not unlock itself. */}
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
          {/* The Save button. This screen does NOT write as you type, unlike every text pane in
              l8: a module is four files describing one thing, and on a shared one a save is a
              publish — a commit and a push onto a repository other people read. That is a
              decision somebody takes, so it gets a button rather than a timer. */}
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
          {/* Beside it, what the files have to say: nothing while they are on disk, amber with
              the reason while one of them is being held back. */}
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
          {/* Left column: the file's text on top, the module's parameters underneath.
              The two answer different questions — what the file SAYS, and what the
              module HAS — and the widget editor on the right binds to the second. */}
          <div className="flex min-h-0 w-1/2 shrink-0 flex-col border-r border-border">
            {/* Three files, one pane. The panel and the presets used to be blocks inside the module file (or
                nowhere at all); they are files beside it now, so the pane says which one you are typing into. */}
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
              {/* Each tab is named by its FILE, and by nothing else. "panel" and "presets" were
                  friendlier words for `ui.yaml` and `presets.yaml`, which read as three views of
                  one thing rather than what they are: three files on disk, each opened, edited
                  and saved on its own. The name is taken from the real path where there is one,
                  so a module written as `module.yml` says so. */}
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
                  // Only for a module that HAS one. A tab that is always there and usually dead
                  // would say every module could have DSP source, which is the opposite of what
                  // the type means.
                  ...(isJsDsp
                    ? ([
                        [
                          "jsdsp",
                          baseName(dspFile?.path) ?? JSDSP_FILE,
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
                  [
                    "presets",
                    baseName(presetFile?.path) ?? PRESETS_BASENAME,
                    presetsDirty,
                    !!presetFile,
                    // A shelf the schema refuses is SAID so, not silently listed as empty: the
                    // dropdown above it would then be missing presets plainly in the file. It is
                    // the one state that still shows on the tab rather than only in its tooltip.
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
                  // What the name no longer says — absent, unread — lives here rather than in
                  // the label, so the tab reads as the file it opens.
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
            <div className="min-h-0 flex-1">
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
                      : pane === "jsdsp"
                        ? onDspChange
                        : onCodeChange
                }
                // Ctrl+S and vim's `:w` mean Save — the same button, not just this pane.
                onSave={() => void saveAll()}
              />
            </div>
            <ParamsPane rows={paramRows} />
          </div>
          {/* Right column, split the same way as the left: the thing you EDIT above, a
              read-only view of what it produces below, both 30% tall. The grid draws the
              panel's geometry; the preview draws the node that geometry becomes. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <WidgetGridEditor
                ui={ui}
                // The params that take a FILE rather than a number — a dropdown bound to one
                // offers the module's own assets/. A fixed list now, not a scan of the project:
                // the choices belong to the module, so there is nothing project-wide to read.
                assetParams={[...FILE_PARAMS]}
                // Two reasons a grid does not take a drag, and they mean the same thing to it:
                // the panel does not parse, or nothing here is being written yet.
                disabled={!parsable || !!readOnly}
                onChange={onUiChange}
              />
            </div>
            {renderPreview && (
              <div className="h-[30%] min-h-0 shrink-0 grow-0 border-t border-border">
                {renderPreview({ ui, params: paramValues })}
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

// What an `io: in` module has to bind instead. It runs no plugin — the input IS the module — so without these
// its panel had nothing to put on it. Namespaced like the track intrinsics, and for the same reason: `gain` is
// a name plugins use constantly, and a bare one would be ambiguous the day an input sat beside one.
const IO_IN_BINDS: { name: string; meta: ParamMeta }[] = [
  // ±24 dB: the range an input trim is asked for, from a quiet guitar to a hot line. Tracktion does not clamp
  // this one, so the bound is a judgement about what is useful rather than about what would be ignored.
  { name: "@gain", meta: { min: -24, max: 24 } },
  // A DROPDOWN, not a toggle: monitoring is three-state, and "auto" — audible once armed — is the default and
  // is neither on nor off. A toggle here would have hidden the value the input actually has.
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

// What the FILE says an io setting is, for the params list's value column. An io setting is a top-level field
// (`gain: 6`), not an entry under `params:`, so readParams cannot see it and the row would read "—" on a module
// that plainly sets one.
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

// The parameters, read-only on purpose: a value is edited in the text or by the plugin, never in two places.
// Filtered, because a real plugin has dozens — a list you can only scroll is one you don't read.
function ParamsPane({
  rows,
}: {
  rows: {
    name: string;
    value?: string;
    bound: boolean;
    meta?: ParamMeta;
  }[];
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) => r.name.toLowerCase().includes(needle))
    : rows;

  return (
    <div className="flex h-[30%] min-h-0 shrink-0 grow-0 flex-col border-t border-border bg-card/30">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">Parameters</span>
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
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">
            {rows.length === 0
              ? "no parameters known — the module sets none, and the engine has no live plugin to ask"
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
              {/* Dimmed when the file doesn't set it: the param exists and can be
                  bound, but this module leaves it at the plugin's own value. */}
              <span
                className={`min-w-0 flex-1 truncate ${r.value === undefined ? "text-muted-foreground" : "text-foreground"}`}
              >
                {r.name}
              </span>
              {/* What the parameter spans, when the engine could tell us. Worth the
                  column: it is the number a knob has to be given, and reading it here
                  beats opening the plugin to find out. */}
              {/* A discrete parameter shows its setting count instead of its bounds —
                  "0…1" says nothing about a filter type, and the count is the cue that
                  dropping it makes a dropdown rather than a knob. */}
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

// A pick used to be resolved HERE, from a module name through hints.paths — which by construction only holds
// the project's OWN modules, so a shared one came back "couldn't resolve". The builder opens the catalogue now
// (see moduleCatalogue.ts), and that already carries the file and both refs, so nothing is left to resolve.
