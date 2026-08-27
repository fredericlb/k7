// timelineLegend.ts — what the timeline's header advertises, per MODE and DERIVED from what
// actually binds. The legend used to be a hand-written string, so it lied the moment anyone
// rebound a key in the preferences; a row naming a command nothing binds is now DROPPED instead.
// Same rule HelpPage keeps (`shortcutsByCommand`, keys.ts). See docs/timeline.md.

import type { TimelineMode } from "./timelineMode";

export interface LegendRow {
  /** The command this row names — looked up in what binds. Absent for the pane's OWN continuous keys, which name none by design (keys.ts). */
  command?: string;
  /** …and then the key is written here, being the pane's rather than the keymap's. */
  key?: string;
  what: string;
}

/** One list per mode: what the keyboard does HERE, which is the whole point of naming the modes. */
export const LEGEND: Record<TimelineMode, LegendRow[]> = {
  normal: [
    { key: "hjkl/arrows", what: "move" },
    { key: "←", what: "at beat 1 selects the row" },
    { command: "transport toggle", what: "play/pause" },
    { command: "transport rewind", what: "rewind" },
    { command: "transport locate", what: "playhead to caret" },
    { command: "ui edit sequence", what: "edit clip" },
    { command: "event move", what: "move clip" },
    { command: "track mute", what: "mute" },
    { command: "track solo", what: "solo" },
    { command: "transport arm", what: "rec" },
    { command: "ui select", what: "select" },
    { command: "ui zoom", what: "zoom in" },
    { command: "ui tool cut", what: "blade" },
    { command: "ui tool erase", what: "erase" },
  ],
  select: [
    { key: "hjkl/arrows", what: "grow" },
    { command: "ui select", what: "cancel" },
    { command: "ui zoom", what: "zoom to it" },
    { command: "transport loop", what: "loop it" },
    { command: "selection copy", what: "copy" },
  ],
  move: [
    { key: "←/→ · j/m", what: "nudge" },
    { key: "enter", what: "commit" },
    { key: "esc", what: "cancel" },
  ],
};

/** …and, when a tool is in hand, how to put it down — appended rather than a fourth mode: a tool is the other axis. */
export const TOOL_LEGEND: LegendRow[] = [
  { command: "ui tool pointer", what: "back to the arrow" },
];

/**
 * The rows to draw: a `command` row keeps only the key that BINDS it, so a legend cannot
 * advertise one that does not, and a rebound key shows its new token without an edit here.
 */
export function legendRows(
  mode: TimelineMode,
  shortcuts: Record<string, string>,
  toolHeld = false,
): { key: string; what: string }[] {
  const rows = [...LEGEND[mode], ...(toolHeld ? TOOL_LEGEND : [])];
  return rows.flatMap((r) => {
    if (!r.command) return r.key ? [{ key: r.key, what: r.what }] : [];
    const key = shortcuts[r.command];
    return key ? [{ key, what: r.what }] : [];
  });
}
