// EditorSettingsPage.tsx — the editor-settings screen (reached from the cog menu).
// For now a single setting: vim mode. The STATE lives in App — it also drives the
// editor toolbar's Vim button — so this screen is a second control for the same
// preference, not a second copy of it.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft, SlidersHorizontal, Terminal } from "lucide-react";
import { m } from "../paraglide/messages.js";

export function EditorSettingsPage({
  vimMode,
  onToggleVim,
  onBack,
}: {
  vimMode: boolean;
  onToggleVim: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <SlidersHorizontal className="h-5 w-5" /> {m["settings.editor"]()}
          </h1>
          <Button variant="secondary" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> {m["sshKey.back"]()}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {m["editorSettings.vim"]()}
            </div>
            <div className="text-xs text-muted-foreground">
              {m["editorSettings.vimHint"]()}
            </div>
          </div>
          <Button
            size="sm"
            variant={vimMode ? "default" : "secondary"}
            aria-pressed={vimMode}
            onClick={onToggleVim}
          >
            <Terminal className="mr-1 h-4 w-4" />
            {vimMode ? m["common.on"]() : m["common.off"]()}
          </Button>
        </div>
      </div>
    </div>
  );
}
