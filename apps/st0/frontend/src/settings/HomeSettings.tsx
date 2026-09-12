// HomeSettings.tsx — the cog on the home page, as a PANEL docked at the right: beside the
// repositories rather than covering them, because the deploy key is pasted at a git host with
// the list of what needs it still on screen. The editor's own panel has the same shape
// (../components/SettingsPanel.tsx). See ../../docs/settings.md.

import { Button } from "@frediverse/ui/button";
import { Settings, X } from "lucide-react";
import { useEffect } from "react";
import { m } from "../paraglide/messages.js";
import { LanguageSection } from "./LanguageSection";
import { SyncSection } from "./SyncSection";

export function HomeSettings({ onClose }: { onClose: () => void }) {
  // Escape closes it, like the editor's panel: a surface you have to aim at is one you leave open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="flex w-[24rem] min-w-0 shrink-0 flex-col overflow-y-auto border-l border-border bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {m["settings.title"]()}
        </span>
        <Button
          size="icon"
          variant="ghost"
          title={m["common.close"]()}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex flex-col gap-4 p-3">
        <p className="text-muted-foreground text-xs">
          {m["settings.trayHint"]()}
        </p>
        <LanguageSection />
        <SyncSection />
      </div>
    </aside>
  );
}
