// EditorSettingsPage.tsx — the editor's settings, a TAB of the settings panel.
// For now a single setting: vim mode. The STATE lives in App — it also drives the
// editor toolbar's Vim button — so this screen is a second control for the same
// preference, not a second copy of it.
//
// It draws the switch and nothing else: the title, the frame and the way back are the panel's
// (SettingsPanel.tsx), which is a lot of chrome to repeat for one control.

import { Button } from "@frediverse/ui/button";
import { Terminal } from "@frediverse/ui/icons";
import { m } from "../paraglide/messages.js";

export function EditorSettingsPage({
  vimMode,
  onToggleVim,
}: {
  vimMode: boolean;
  onToggleVim: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
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
