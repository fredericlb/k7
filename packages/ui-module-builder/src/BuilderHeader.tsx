// BuilderHeader.tsx — the module builder's top bar: Back, the module's name and path, the plugin's
// factory presets, the module's `status:`, and the one Save button with what the files say beside
// it. It owns nothing; every action is the screen's. See docs/builder.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  ArrowLeft,
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
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import {
  MODULE_STATUSES,
  type ModuleStatus,
} from "@studio/song-schema/moduleTypes";
import type { loudest } from "@studio/ui-editor/autosave";
import type { PresetInfo } from "@studio/web-protocol";

/** What each `status:` is CALLED on screen — a label, not a second spelling; packages/song/docs/moduleStatus.md. */
const STATUS_LABEL: Record<ModuleStatus, string> = {
  listed: "listed",
  favorite: "first",
  hidden: "hidden",
};

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

export function BuilderHeader({
  kind,
  moduleName,
  path,
  presets,
  applyPreset,
  readOnly,
  moduleStatus,
  setModuleStatus,
  onRequestEdit,
  leave,
  refresh,
  saveAll,
  anyDirty,
  publishing,
  saveState,
}: {
  kind: "base" | "module";
  moduleName: string;
  path: string;
  presets: PresetInfo[];
  applyPreset: (p: PresetInfo) => void;
  readOnly?: boolean;
  moduleStatus: ModuleStatus;
  setModuleStatus: (s: ModuleStatus) => void;
  onRequestEdit?: () => void;
  leave: () => Promise<void>;
  refresh: () => Promise<void>;
  saveAll: () => Promise<void>;
  anyDirty: boolean;
  publishing: boolean;
  saveState: ReturnType<typeof loudest>;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border px-3 py-2">
      <Button variant="secondary" size="sm" onClick={() => void leave()}>
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
        {/* The plugin's FACTORY presets; a node's own are the graph's dropdown — packages/song/docs/userPresets.md. */}
        {presets.length > 0 && (
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
            onValueChange={(v) => setModuleStatus(v as ModuleStatus)}
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
        {/* Refresh: the files as they are on disk, after an edit made outside the builder — a Claude Code session, a text editor. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={publishing || saveState.status === "saving"}
          title="reload the module's files from disk — after an edit made outside the builder"
          aria-label="Reload from disk"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        {/* A button and not a timer, because on a shared module a save is a publish — ../docs/builder.md. */}
        {!readOnly && (
          <Button
            size="sm"
            onClick={() => void saveAll()}
            disabled={!anyDirty || publishing || saveState.status === "saving"}
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
  );
}
