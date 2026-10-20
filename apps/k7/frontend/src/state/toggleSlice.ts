// toggleSlice.ts — the shell's view toggles that a command flips and a pane reads: the right
// column, the help page, the graph's notes and stack view, the lane curves, the rack builder,
// the History hover. Nothing here is written to a file; all of it is lost on reload.

import type { SettingsTab } from "../components/SettingsPanel";
import type { HistoryMark } from "../historyMarks";
import type { RightPanelId } from "../ui/commands/context";
import { type Setter, type SliceSet, setterOf } from "./overlaySlice";

export interface ToggleSlice {
  /** Which panel has the RIGHT COLUMN, or null — one state because there is one column (docs/shell.md). */
  rightPanel: RightPanelId | null;
  setRightPanel: Setter<RightPanelId | null>;
  /** Open `which`, or close it when it is already the one showing — every panel button toggles. */
  toggleRight: (which: RightPanelId) => void;
  /** Which tab the settings panel shows, kept while closed so the cog reopens where you left it. */
  settingsTab: SettingsTab;
  setSettingsTab: Setter<SettingsTab>;
  /** The documentation overlay (/docs), mirrored in the URL by useViewRoute. */
  showHelp: boolean;
  setShowHelp: Setter<boolean>;
  /** Whether the graph draws the project's NOTES, and how many there are — the count reported by the pane holding the graph. */
  showDocs: boolean;
  setShowDocs: Setter<boolean>;
  docCount: number;
  setDocCount: Setter<number>;
  /** Whether the per-track view draws its curve cards (`ui curves`). */
  trackCurves: boolean;
  setTrackCurves: Setter<boolean>;
  /** The STACK view: a column per lane, the MIX's last — exclusive with the mixer row. */
  stackView: boolean;
  setStackView: Setter<boolean>;
  /** The rack builder popin, opened by `module create rack`. */
  rackBuilder: boolean;
  setRackBuilder: Setter<boolean>;
  /** What the History panel's hovered row touched — lit on the graph and the timeline (historyMarks.ts). */
  historyMark: HistoryMark | null;
  setHistoryMark: Setter<HistoryMark | null>;
}

export function toggleSlice(
  set: SliceSet<ToggleSlice>,
  init: { settingsTab: SettingsTab; showHelp: boolean },
): ToggleSlice {
  return {
    rightPanel: null,
    setRightPanel: setterOf(set, "rightPanel"),
    toggleRight: (which) =>
      set((s) => ({ rightPanel: s.rightPanel === which ? null : which })),
    settingsTab: init.settingsTab,
    setSettingsTab: setterOf(set, "settingsTab"),
    showHelp: init.showHelp,
    setShowHelp: setterOf(set, "showHelp"),
    showDocs: false,
    setShowDocs: setterOf(set, "showDocs"),
    docCount: 0,
    setDocCount: setterOf(set, "docCount"),
    trackCurves: false,
    setTrackCurves: setterOf(set, "trackCurves"),
    stackView: false,
    setStackView: setterOf(set, "stackView"),
    rackBuilder: false,
    setRackBuilder: setterOf(set, "rackBuilder"),
    historyMark: null,
    setHistoryMark: setterOf(set, "historyMark"),
  };
}
