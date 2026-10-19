// paneTabs.ts — the builder's left-column tabs, one per FILE and named by it, then the parameters
// list: which exist for this module, whether each is ready, and what its name does not say.

import type { ModuleSidecarFile, ModuleUiFile } from "@studio/web-protocol";
import { hasLcd, type ModuleUI, WIDGETS_SCRIPT } from "./moduleUi";

/** A path's last segment — the tabs are named by their file, so this is what names them. */
const baseName = (p: string | undefined): string | undefined =>
  p?.split(/[\\/]/).pop() || undefined;

// What the panel is called before it has been read, so a tab is never blank.
const UI_BASENAME = "ui.k7x";

/** Each tab as [pane, label, dirty, ready, note]: three files on disk, not three views of one. */
export function paneTabs({
  path,
  uiFile,
  dspFile,
  scriptFile,
  dspSourceName,
  ui,
  dirty,
}: {
  path: string;
  uiFile: ModuleUiFile | null;
  dspFile: ModuleSidecarFile | null;
  scriptFile: ModuleSidecarFile | null;
  dspSourceName: string | null;
  ui: ModuleUI;
  dirty: { module: boolean; panel: boolean; dsp: boolean; widgets: boolean };
}) {
  return [
    ["module", baseName(path), dirty.module, true, null],
    [
      "panel",
      baseName(uiFile?.path) ?? UI_BASENAME,
      dirty.panel,
      !!uiFile,
      uiFile ? null : "not read yet",
    ],
    // Only for a module that HAS one: an always-there, usually dead tab would mislead.
    ...(dspSourceName
      ? ([
          [
            "dsp",
            baseName(dspFile?.path) ?? dspSourceName,
            dirty.dsp,
            !!dspFile,
            dspFile
              ? dspFile.exists
                ? null
                : "doesn't exist yet — saving creates it"
              : "this host does not serve it",
          ],
        ] as const)
      : []),
    // Only once the panel draws a screen, or the file is there anyway — the DSP tab's rule.
    ...(scriptFile && (scriptFile.exists || hasLcd(ui))
      ? ([
          [
            "widgets",
            baseName(scriptFile.path) ?? WIDGETS_SCRIPT,
            dirty.widgets,
            true,
            scriptFile.exists ? null : "doesn't exist yet — saving creates it",
          ],
        ] as const)
      : []),
    // Not a file, and last for that reason — see BuilderPane.
    ["params", "parameters", false, true, null],
  ] as const;
}
