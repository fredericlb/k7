// EditorToolbar.tsx — the editor pane's top bar: the breadcrumb, a sequence's three views in the
// popin, the module builder's door, a clip's Process menu, and the save state in place of a Save
// button — and the bar that says the open file moved on disk under an edit. See ../../docs/shell.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  FileText,
  Grid3x3,
  LayoutGrid,
  Loader2,
  Piano,
  TriangleAlert,
  Wand2,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { docPattern } from "@studio/song-schema/docExt";
import type { AutosaveStatus } from "@studio/ui-editor/autosave";
import { m } from "../paraglide/messages.js";
import {
  isClipFile,
  isModuleFile,
  moduleFileOf,
  projectDir,
} from "../projectPaths";
import { needsAttention, saveLabel } from "../saveLabel";
import type { SeqView } from "../sequenceEdit";
import type { FileContent, FileNode } from "../types";
import { Breadcrumb } from "./Breadcrumb";
import { ChainOpsList } from "./ChainOpsList";

const UI_FILE = docPattern("ui");

// The popin's three views of a sequence, in the order they read: the file, then its notes twice.
const SEQ_TABS = [
  { id: "text", label: "Text", icon: FileText, title: "the file itself" },
  {
    id: "roll",
    label: "Roll",
    icon: Piano,
    title: "its notes as a piano roll",
  },
  {
    id: "tracker",
    label: "Tracker",
    icon: Grid3x3,
    title: "its notes as a tracker (arrows move, keys type notes)",
  },
] as const;

export function EditorToolbar({
  tree,
  file,
  activeProject,
  projectName,
  onOpen,
  onOpenProject,
  seqTabs,
  tab,
  onTab,
  onOpenBuilder,
  processing,
  opSearch,
  onOpSearch,
  clipOps,
  onProcess,
  autosave,
}: {
  tree: FileNode[];
  file: FileContent | null;
  activeProject: string | null;
  projectName: string | null;
  onOpen: (path: string) => void;
  onOpenProject: (path: string) => void;
  /** Whether the sequence views are offered: a sequence, in the popin. */
  seqTabs: boolean;
  tab: "text" | SeqView;
  onTab: (tab: "text" | SeqView) => void;
  onOpenBuilder: (path: string, pane: "module" | "panel") => void;
  processing: boolean;
  opSearch: string;
  onOpSearch: (q: string) => void;
  clipOps: string[];
  onProcess: (chain: string) => void;
  autosave: { status: AutosaveStatus; reason: string | null };
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
      <Breadcrumb
        tree={tree}
        path={file?.path ?? null}
        // Where `tree` is rooted: paths stay workspace-relative, so the breadcrumb needs BOTH to tell the two spaces apart.
        root={projectDir(activeProject)}
        // In a workspace the folder name IS the project; alone, only the song knows what it is called.
        rootLabel={
          projectDir(activeProject).split("/").pop() || projectName || "project"
        }
        activeProject={activeProject}
        onOpen={onOpen}
        onOpenProject={onOpenProject}
      />
      <div className="flex-1" />
      {/* A sequence in the POPIN gets its three views as tabs, text and the two grids as peers (docs/shell.md). */}
      {seqTabs && (
        <div
          role="tablist"
          aria-label={m["seq.views"]()}
          className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
        >
          {SEQ_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              title={t.title}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              onClick={() => onTab(t.id)}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      )}
      {/* A BUTTON and not a redirected click: opening `module.yaml` must still open its text, the path a shared module forks through. */}
      {file && isModuleFile(file.path) && (
        <Button
          size="sm"
          variant="secondary"
          title={m["editor.openInBuilder"]()}
          onClick={() =>
            onOpenBuilder(
              moduleFileOf(file.path),
              UI_FILE.test(file.path) ? "panel" : "module",
            )
          }
        >
          <LayoutGrid className="mr-1 h-4 w-4" />
          Builder
        </Button>
      )}
      {/* The waveform panel's "operations" menu on the clip's TEXT (../clipOps.ts); the reload keeps the buffer off the repointed `source:`. */}
      {file && isClipFile(file.path) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              disabled={processing}
              title={m["editor.runChain"]()}
            >
              {processing ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-1 h-4 w-4" />
              )}
              Process
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 p-1">
            <ChainOpsList
              search={opSearch}
              onSearch={onOpSearch}
              ops={clipOps}
              onPick={onProcess}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* In place of a Save button: silent while the file is saved, amber with the reason for as long as it is not. */}
      <span
        className={cn(
          "flex min-w-0 shrink items-center gap-1 text-xs",
          needsAttention(autosave.status)
            ? "text-amber-500"
            : "text-muted-foreground",
        )}
        title={autosave.reason ?? undefined}
      >
        {autosave.status === "saving" && (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        )}
        <span className="truncate">
          {saveLabel(autosave.status, autosave.reason)}
        </span>
      </span>
    </div>
  );
}

/** The open file changed on disk under an edit in progress: both versions are real work, so this states the choice and waits. */
export function DiskConflictBar({
  onKeep,
  onTake,
}: {
  onKeep: () => void;
  onTake: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
      <span className="min-w-0 flex-1">{m["disk.changed"]()}</span>
      {/* Each button says what it THROWS AWAY: both versions are someone's work. */}
      <Button size="sm" variant="secondary" onClick={onKeep}>
        {m["disk.keepMine"]()}
      </Button>
      <Button size="sm" onClick={onTake}>
        {m["disk.takeTheirs"]()}
      </Button>
    </div>
  );
}
