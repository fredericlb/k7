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
  type LucideIcon,
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
 *  pistes has panes of its own and a shared package must not squat the word. */
export type BuilderPane = "module" | "panel" | "presets";

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
  onBack,
  onSaved,
  setStatus,
  presets,
  onListPresets,
  onSetPreset,
  pluginParamNames,
  pluginParamMeta,
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
  // A save the host redirected — pistes forks a shared module rather than writing into it, so the
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
  const [dirty, setDirty] = useState(false);
  // The module's panel is the `ui.yaml` beside its module file (see uiLibrary.ts), which is what the grid
  // edits. It may not exist yet — the server answers with the path it WOULD take and a blank grid, so the
  // first save creates it through the ordinary write route.
  const [uiFile, setUiFile] = useState<ModuleUiFile | null>(null);
  const [uiDirty, setUiDirty] = useState(false);
  // …and the third file, the module's named settings. Read as a FILE like the other two, not fetched as a
  // list, because it is one you type into as readily as you click (see moduleUi.ts).
  const [presetFile, setPresetFile] = useState<ModulePresetsFile | null>(null);
  const [presetsDirty, setPresetsDirty] = useState(false);
  // Which file the CODE pane shows. Three files, one pane: what the module IS, how it is drawn, and its named
  // settings. The PANEL opens first — it is what the grid beside it edits, and what people come to this screen
  // for. The other two are a tab away.
  const [pane, setPane] = useState<BuilderPane>(initialPane ?? "panel");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Factory presets need a live plugin instance, so ask only when editing the module itself.
  useEffect(() => {
    if (kind === "module") onListPresets(moduleName);
  }, [kind, moduleName, onListPresets]);

  // Which of the two sidecars the pane is on, or null when it is on the module file itself. One expression,
  // because three places downstream ask the same question and answering it three times is how they drift.
  const sidecar =
    pane === "panel" ? uiFile : pane === "presets" ? presetFile : null;

  // The module's OWN presets, off its shelf. A name and the values it sets — nothing else is recorded.
  const shelf = useMemo(
    () => (presetFile ? readPresetsFile(presetFile.content) : {}),
    [presetFile],
  );

  /**
   * Apply a preset from the shelf: stamp its values into the module BUFFER.
   *
   * An edit and nothing more — no state to push, no engine to ask. It lands unsaved, so it is visible before it
   * is committed and undone by not saving, which is what makes trying four presets in a row bearable.
   */
  const applyShelfPreset = useCallback(
    (name: string) => {
      const values = shelf[name];
      if (!values || content == null) return;
      setContent(applyPresetToText(content, values));
      setDirty(true);
      setStatus(`preset: ${name}`);
    },
    [shelf, content, setStatus],
  );

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
    setDirty(false);
    setUiDirty(false);
    setPresetsDirty(false);
    setError(null);
    store
      .read(path)
      // Absent is a buffer, not an error — see ModuleStore.read.
      .then((text) => alive && setContent(text ?? ""))
      .catch((e) => alive && setError((e as Error).message));
    // The panel is fetched separately and is allowed to fail: a file that isn't a module (a base being edited
    // by path, say) still opens for its text — the grid is just disabled.
    store
      .moduleUi(path)
      .then((f) => {
        if (!alive) return;
        setUiFile(f);
        setUi(readUiFile(f.content));
        setParsable(!hasMalformedUiFile(f.content));
      })
      .catch(() => alive && setParsable(false));
    // The shelf, allowed to fail for the same reason: a file that isn't a module still opens for its text.
    store
      .presets(path)
      .then((f) => alive && setPresetFile(f))
      .catch(() => alive && setPresetFile(null));
    store
      .hints()
      .then((h) => alive && setHints(h))
      .catch(() => {}); // no hints ⇒ the bind list is empty, editing still works
    return () => {
      alive = false;
    };
  }, [path, store]);

  // A visual edit rewrites the PANEL file; the code pane is controlled by it, so switching to it shows the change.
  const onUiChange = useCallback((next: ModuleUI) => {
    setUi(next);
    setUiFile((f) => (f ? { ...f, content: writeUiFile(f.content, next) } : f));
    setParsable(true);
    setUiDirty(true);
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
      setUiDirty(true);
      return { ...f, content: text };
    });
  }, []);

  // A code edit in the SHELF: no grid to sync, only the dropdown, which reads it fresh each render.
  const onPresetsChange = useCallback((text: string) => {
    setPresetFile((f) => {
      if (!f || f.content === text) return f;
      setPresetsDirty(true);
      return { ...f, content: text };
    });
  }, []);

  // A code edit in the MODULE file touches no grid — the panel moved out of it.
  const onCodeChange = useCallback((text: string) => {
    setContent((c) => {
      if (c === text) return c;
      setDirty(true);
      return text;
    });
  }, []);

  const save = useCallback(async () => {
    if (content == null) return;
    setSaving(true);
    try {
      // The panel first, and on its own path: it is the ordinary case — the grid is what people come here for.
      // A panel saves in place wherever it is, shared library included, so nothing can redirect it.
      if (uiDirty && uiFile) {
        await store.write(uiFile.path, uiFile.content);
        setUiDirty(false);
        setUiFile((f) => (f ? { ...f, exists: true } : f));
        setStatus(`saved ${uiFile.path}`);
        onSaved();
        if (!dirty) return;
      }
      // The shelf, same rule as the panel: it is the module's own file and saves where the module is.
      if (presetsDirty && presetFile) {
        await store.write(presetFile.path, presetFile.content);
        setPresetsDirty(false);
        setPresetFile((f) => (f ? { ...f, exists: true } : f));
        setStatus(`saved ${presetFile.path}`);
        onSaved();
        if (!dirty) return;
      }
      // The module file CAN be redirected: pistes copies a shared module into the project rather
      // than writing into the library. The host is told and reopens — following the new path from
      // here would leave the engine link and the title pointing at the module that was not edited.
      const landed = await store.write(path, content);
      onSaved();
      if (landed.path && landed.path !== path) {
        setDirty(false);
        setStatus(landed.note ?? `saved ${landed.path}`);
        onRelocated?.(landed.path);
        return;
      }
      // Read back what landed, as this editor always did on save.
      try {
        setContent((await store.read(path)) ?? "");
      } catch {
        /* cosmetic */
      }
      setDirty(false);
      setStatus(`saved ${path}`);
    } catch (e) {
      setStatus(`save error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [
    store,
    content,
    path,
    uiFile,
    uiDirty,
    presetFile,
    presetsDirty,
    dirty,
    onSaved,
    onRelocated,
    setStatus,
  ]);

  const params = paramRef ? (hints?.paramsByBase[paramRef] ?? []) : [];
  // Ranges for a built-in whose params pistes defines (see builtinParams.ts). The engine's live report is
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
          {(presets.length > 0 || Object.keys(shelf).length > 0) && (
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
                {Object.keys(shelf).length > 0 && (
                  <div>
                    <DropdownMenuLabel>This module</DropdownMenuLabel>
                    {Object.keys(shelf).map((name) => (
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
          <Button
            size="sm"
            // Either file being dirty is unsaved work, and one button saves both.
            variant={dirty || uiDirty ? "default" : "secondary"}
            disabled={saving || content == null}
            onClick={() => void save()}
          >
            {saving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Save{dirty || uiDirty ? " *" : ""}
          </Button>
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
              {(
                [
                  ["module", path.split("/").slice(-2).join("/"), dirty, true],
                  [
                    "panel",
                    uiFile ? "panel" : "panel (none)",
                    uiDirty,
                    !!uiFile,
                  ],
                  [
                    "presets",
                    // A shelf the schema refuses is SAID so, not silently listed as empty: the dropdown
                    // above it would then be missing presets that are plainly in the file.
                    presetFile && hasMalformedPresets(presetFile.content)
                      ? "presets (malformed)"
                      : presetFile?.exists
                        ? "presets"
                        : "presets (none)",
                    presetsDirty,
                    !!presetFile,
                  ],
                ] as const
              ).map(([id, label, isDirty, ready]) => (
                <button
                  key={id}
                  type="button"
                  disabled={!ready}
                  onClick={() => setPane(id)}
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
            <div className="min-h-0 flex-1">
              <YamlPane
                path={sidecar ? sidecar.path : path}
                content={sidecar ? sidecar.content : content}
                hints={hints}
                vimMode={vimMode}
                onChange={
                  pane === "panel"
                    ? onPanelChange
                    : pane === "presets"
                      ? onPresetsChange
                      : onCodeChange
                }
                onSave={() => void save()}
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
                // The library FOLDERS, from the flat file list in hints: a dropdown picks a folder and its files are the choices.
                libraryKinds={[
                  ...new Set(
                    (hints?.libraryFiles ?? [])
                      .map((f) => f.split("/")[0])
                      .filter(Boolean),
                  ),
                ].sort()}
                disabled={!parsable}
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
