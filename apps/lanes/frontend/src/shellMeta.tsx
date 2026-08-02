// shellMeta.tsx — the shell's static tables (panes, views, panels: icon + label) and the
// two tiny presentational pieces the header uses (the transport clock, the metronome
// glyph). Extracted from App.tsx so the shell reads as wiring, not tables.

import { useEngineState } from "@studio/engine-browser/store";
import {
  AudioWaveform,
  Clapperboard,
  FileCode,
  LayoutGrid,
  type LucideIcon,
  NotebookText,
  Piano,
  ScrollText,
  SlidersVertical,
  Video,
  Workflow,
} from "lucide-react";
import type { Pane, Panel, View } from "./routes";

// The three panes, not tabs: the global view shows all three, and a "view" is a LAYOUT over the same instances.
// `viewport` is absent because it only exists for a song WITH video; this is the set that can be fullscreened.
export const PANES: Pane[] = ["editor", "timeline", "chains"];
export const ALL_PANES: Pane[] = [...PANES, "viewport"];

// Max gap between the two Shift presses that open the command palette (IntelliJ style).
export const DOUBLE_SHIFT_MS = 400;

export const PANE_META: Record<Pane, { icon: LucideIcon; label: string }> = {
  editor: { icon: FileCode, label: "Editor" },
  timeline: { icon: AudioWaveform, label: "Timeline" },
  chains: { icon: Workflow, label: "Chains" },
  viewport: { icon: Video, label: "Viewport" },
};

// The two layouts, and the pane each puts in the bottom-right slot.
export const VIEW_META: Record<
  View,
  { icon: LucideIcon; label: string; third: Pane }
> = {
  global: { icon: LayoutGrid, label: "Global", third: "chains" },
  video: { icon: Clapperboard, label: "Video", third: "viewport" },
};

// The bottom panels: `editor` is the clip editor, `mixer` the strips, `graph` the caret track's path, `logs` both.
export const PANEL_META: Record<Panel, { icon: LucideIcon; label: string }> = {
  editor: { icon: Piano, label: "Editor" },
  mixer: { icon: SlidersVertical, label: "Mixer" },
  graph: { icon: Workflow, label: "Graph" },
  docs: { icon: NotebookText, label: "Docs" },
  logs: { icon: ScrollText, label: "Logs" },
};

// The moving clock, its OWN component so the ~20 Hz playhead re-renders one <span>. Needs <EngineStoreProvider>.
export function TransportClock({
  tempo,
  beatsPerBar,
}: {
  tempo: number;
  beatsPerBar: number;
}) {
  const s = useEngineState((st) => st.playhead);
  const clock = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  // Position as 1-based bar:beat, clamped at 0 so a count-in's negative playhead doesn't read as a negative bar.
  const beat = Math.max(0, (s * tempo) / 60);
  const bpb = Math.max(1, beatsPerBar);
  const bar = Math.floor(beat / bpb) + 1;
  const beatInBar = Math.floor(beat % bpb) + 1;
  return (
    <span className="mx-1 whitespace-nowrap font-mono text-xs text-muted-foreground tabular-nums">
      {clock}
      <span className="mx-1 text-border">·</span>
      {bar}:{beatInBar}
    </span>
  );
}

// A metronome glyph hand-drawn in lucide's style (24-grid, currentColor, round caps), since lucide has none.
export function MetronomeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3h6l5 18H4z" />
      <path d="M12 18 16 7" />
      <path d="M8 13h8" />
    </svg>
  );
}
