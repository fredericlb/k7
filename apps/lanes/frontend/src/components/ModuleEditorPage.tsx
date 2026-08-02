// ModuleEditorPage.tsx — the full-screen module editor: the file's text on the LEFT, a
// visual grid of its UI widgets on the RIGHT. Both edit ONE file — the right pane owns
// only the `ui:` block and rewrites it in place, leaving the rest byte-identical, while
// typing flows the other way whenever the block still parses (it greys out when it doesn't).

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Input } from "@frediverse/ui/input";
import { cn } from "@frediverse/ui/lib/utils";
import type { ParamMeta } from "@studio/engine-protocol";
import {
  ArrowLeft,
  ChevronDown,
  Folder,
  LayoutGrid,
  Loader2,
  type LucideIcon,
  Plus,
  Save,
  SlidersHorizontal,
  UserCircle2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  hasMalformedUiFile,
  ioOf,
  type ModuleUI,
  readParams,
  readUiFile,
  writeUiFile,
} from "../moduleUi";
import { setParamDrag } from "../paramDrag";
import type { ForkedModule, Hints, ModuleUiFile, PresetInfo } from "../types";
import { EditorPane } from "./EditorPane";
import { WidgetGridEditor } from "./WidgetGridEditor";

// The preset menu's sections in display order, each with the icon for its source: user, program bank, OS file.
const PRESET_GROUPS: {
  source: PresetInfo["source"];
  label: string;
  Icon: LucideIcon;
}[] = [
  { source: "user", label: "My presets", Icon: UserCircle2 },
  { source: "program", label: "Programs", Icon: LayoutGrid },
  { source: "file", label: "Factory presets", Icon: Folder },
];

export function ModuleEditorPage({
  path,
  kind,
  moduleName,
  paramRef,
  presetRef,
  vimMode,
  onBack,
  onSaved,
  editShared,
  onForked,
  setStatus,
  presets,
  onListPresets,
  onSetPreset,
  pluginParamNames,
  pluginParamMeta,
}: {
  path: string; // the file being edited (the module, or the base it extends)
  kind: "base" | "module";
  moduleName: string; // the module that was clicked (for the title)
  // The ref whose params feed the `bind` dropdown. May be null — the list is then empty, free-text bind still works.
  paramRef: string | null;
  // The ref whose preset library this reads/writes — always the FILE being edited. Null means no user presets.
  presetRef: string | null;
  vimMode: boolean;
  onBack: () => void;
  onSaved: () => void; // bump the shell's reloadKey so the graph redraws
  // Set when the editor came from the module BUILDER, whose whole subject is the shared catalogue: the save
  // writes `_modules` in place instead of forking a project copy, and every project sees the edit.
  editShared?: boolean;
  // A shared module was copied into the project on save: re-aim the editor at the copy.
  onForked: (forked: ForkedModule) => void;
  setStatus: (s: string) => void;
  // Presets the module's external plugin offers, and the two calls behind the dropdown. Empty for a built-in.
  presets: PresetInfo[];
  onListPresets: (module: string) => void;
  onSetPreset: (module: string, sel: { index?: number; path?: string }) => void;
  // Live param names from the engine for the plugin loaded on this module's chain.
  pluginParamNames?: string[];
  // …and what each spans, so a bound widget adopts the real range instead of the placeholder 0..1.
  pluginParamMeta?: Record<string, ParamMeta>;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [ui, setUi] = useState<ModuleUI | null>(null);
  const [parsable, setParsable] = useState(true);
  const [hints, setHints] = useState<Hints | null>(null);
  const [dirty, setDirty] = useState(false);
  // The module's panel is a file of its own in the workspace's `_ui` library (see uiLibrary.ts), which is what
  // the grid edits. It may not exist yet — the server answers with the path it WOULD take and a blank grid, so
  // the first save creates it through the ordinary write route.
  const [uiFile, setUiFile] = useState<ModuleUiFile | null>(null);
  const [uiDirty, setUiDirty] = useState(false);
  // Which file the CODE pane shows. Two files, one pane: the module says what it is, the panel how it's drawn.
  // The PANEL opens first — it is what the grid beside it edits, and what people come to this screen for. The
  // module file is a tab away, for the times the plugin itself needs changing.
  const [pane, setPane] = useState<"module" | "panel">("panel");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // User presets live in the song and come from the file service; factory ones ride the socket. Refetched on save.
  const [userPresets, setUserPresets] = useState<PresetInfo[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  // Factory presets need a live plugin instance, so ask only when editing the module itself.
  useEffect(() => {
    if (kind === "module") onListPresets(moduleName);
  }, [kind, moduleName, onListPresets]);

  const loadUserPresets = useCallback(() => {
    if (!presetRef) return setUserPresets([]);
    api
      .listUserPresets(presetRef)
      .then((r) => setUserPresets(r.presets))
      .catch(() => setUserPresets([])); // no active project / bad ref ⇒ just the engine's
  }, [presetRef]);
  useEffect(() => loadUserPresets(), [loadUserPresets]);

  // Apply a preset: a user preset is written onto the module by the brain, a factory one goes to the live plugin.
  const applyPreset = useCallback(
    (p: PresetInfo) => {
      if (p.source === "user") {
        // The brain rewrote the file and reloaded — re-read it so editor and grid follow, and bump the shell to redraw.
        api
          .applyPreset(moduleName, p.path)
          .then(() => api.read(path))
          .then((f) => {
            // Only the module file: a preset sets params, and the panel it is drawn on is a different file.
            setContent(f.content);
            setDirty(false);
            setStatus(`preset: ${p.name}`);
            onSaved();
          })
          .catch((e) => setStatus(`preset error: ${(e as Error).message}`));
      } else {
        onSetPreset(moduleName, { index: p.index, path: p.path });
        setStatus(`preset: ${p.name}`);
      }
    },
    [moduleName, path, onSetPreset, onSaved, setStatus],
  );

  const doSavePreset = useCallback(async () => {
    const name = saveName.trim();
    if (!name) return;
    setSavingPreset(true);
    try {
      await api.savePreset(moduleName, name);
      setStatus(`saved preset "${name}"`);
      setSaveOpen(false);
      setSaveName("");
      loadUserPresets();
    } catch (e) {
      setStatus(`save preset error: ${(e as Error).message}`);
    } finally {
      setSavingPreset(false);
    }
  }, [saveName, moduleName, setStatus, loadUserPresets]);

  // Load the file and the project's hints once, for this path.
  useEffect(() => {
    let alive = true;
    setContent(null);
    setUiFile(null);
    setDirty(false);
    setUiDirty(false);
    setError(null);
    api
      .read(path)
      .then((f) => alive && setContent(f.content))
      .catch((e) => alive && setError((e as Error).message));
    // The panel is fetched separately and is allowed to fail: a file that isn't a module (a base being edited
    // by path, say) still opens for its text — the grid is just disabled.
    api
      .moduleUi(path)
      .then((f) => {
        if (!alive) return;
        setUiFile(f);
        setUi(readUiFile(f.content));
        setParsable(!hasMalformedUiFile(f.content));
      })
      .catch(() => alive && setParsable(false));
    api
      .hints()
      .then((h) => alive && setHints(h))
      .catch(() => {}); // no hints ⇒ the bind list is empty, editing still works
    return () => {
      alive = false;
    };
  }, [path]);

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
      // The panel first, and on its own path: it is the ordinary case (the grid is what people come here for),
      // and it never forks — `_ui` is writable where `_modules` is not.
      if (uiDirty && uiFile) {
        await api.write(uiFile.path, uiFile.content);
        setUiDirty(false);
        setUiFile((f) => (f ? { ...f, exists: true } : f));
        setStatus(`saved ${uiFile.path}`);
        onSaved();
        if (!dirty) return;
      }
      const { forked } = await api.write(path, content, editShared);
      // Saving a SHARED module copies it into the project instead of writing to the library (which every song
      // in the workspace reads). The editor has to follow the copy, or the next save would fork a second one.
      if (forked) {
        onForked(forked);
        setDirty(false);
        setStatus(
          `${forked.ref} is shared — saved a project copy as ${forked.module}` +
            (forked.chains.length
              ? `, and repointed ${forked.chains.join(", ")}`
              : ""),
        );
        onSaved();
        return;
      }
      // Tidy the file as the brain's own edits do. Best-effort: a write that saved but wouldn't format still saved.
      try {
        setContent((await api.fmt(path)).content);
      } catch {
        /* formatting is cosmetic */
      }
      setDirty(false);
      setStatus(`saved ${path}`);
      onSaved();
    } catch (e) {
      setStatus(`save error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [
    content,
    path,
    uiFile,
    uiDirty,
    dirty,
    editShared,
    onSaved,
    onForked,
    setStatus,
  ]);

  const params = paramRef ? (hints?.paramsByBase[paramRef] ?? []) : [];
  // Ranges for a built-in whose params lanes defines (see builtinParams.ts). The engine's live report is
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
          {/* Presets menu — the user's own (source "user", stored in the song) and the
              plugin's factory ones (source "program"/"file", from the engine), each with a
              distinct icon. Applying either loads it without opening the plugin's window.
              Shown when there's anything to pick, or when editing the module (to offer a save). */}
          {(kind === "module" || userPresets.length + presets.length > 0) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  title="presets — your own, and the plugin's factory ones"
                >
                  <SlidersHorizontal className="mr-1 h-4 w-4" /> Preset
                  <ChevronDown className="ml-1 h-4 w-4 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-[70vh] w-56 overflow-y-auto"
              >
                {userPresets.length + presets.length === 0 && (
                  <DropdownMenuLabel>No presets yet</DropdownMenuLabel>
                )}
                {PRESET_GROUPS.map(({ source, label, Icon }) => {
                  const items = (
                    source === "user" ? userPresets : presets
                  ).filter((p) => p.source === source);
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
                {kind === "module" && (
                  <>
                    {userPresets.length + presets.length > 0 && (
                      <DropdownMenuSeparator />
                    )}
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault(); // keep focus for the dialog that opens
                        setSaveOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4" /> Save as preset…
                    </DropdownMenuItem>
                  </>
                )}
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

      {/* Name-and-save a preset. Snapshots the module's current state (params, or its
          .vstpreset blob) into the module's own preset library. */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save as preset</DialogTitle>
            <DialogDescription>
              Saves {moduleName}'s current state to module{" "}
              <span className="font-mono">{presetRef ?? "—"}</span>'s own preset
              library.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={saveName}
            placeholder="preset name"
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doSavePreset();
            }}
          />
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSaveOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!saveName.trim() || savingPreset}
              onClick={() => void doSavePreset()}
            >
              {savingPreset && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Save preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {/* Two files, one pane. The panel used to be a block inside the module file; it is its own file in
                the workspace's `_ui` now, so the pane says which one you are typing into. */}
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
              {(
                [
                  ["module", path.split("/").slice(-2).join("/"), dirty],
                  ["panel", uiFile ? "panel" : "panel (none)", uiDirty],
                ] as const
              ).map(([id, label, isDirty]) => (
                <button
                  key={id}
                  type="button"
                  disabled={id === "panel" && !uiFile}
                  onClick={() => setPane(id)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs",
                    pane === id
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                    id === "panel" && !uiFile && "opacity-50",
                  )}
                >
                  {label}
                  {isDirty ? " *" : ""}
                </button>
              ))}
              {uiFile && pane === "panel" && (
                <span className="ml-auto truncate text-[11px] text-muted-foreground">
                  {uiFile.path}
                  {uiFile.exists ? "" : " (new)"}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <EditorPane
                file={
                  pane === "panel" && uiFile
                    ? {
                        path: uiFile.path,
                        binary: false,
                        content: uiFile.content,
                      }
                    : { path, binary: false, content }
                }
                hints={hints}
                vimMode={vimMode}
                seqView="none"
                audioClip={null}
                onChange={pane === "panel" ? onPanelChange : onCodeChange}
                onSave={() => void save()}
              />
            </div>
            <ParamsPane rows={paramRows} />
          </div>
          <div className="min-h-0 min-w-0 flex-1">
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
    <div className="flex h-2/5 min-h-0 shrink-0 grow-0 flex-col border-t border-border bg-card/30">
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
