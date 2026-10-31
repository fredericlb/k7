// shellMeta.tsx — the shell's static tables (panes, views, panels: icon + label) and the small
// presentational pieces built on them: the transport clock, the metronome glyph, and the
// mini transport the floating minimap carries. Apart from App.tsx so the shell reads as
// wiring, not tables.

import {
  AudioWaveform,
  Disc3,
  FileCode,
  Gauge,
  Loader2,
  type LucideIcon,
  MonitorPlay,
  Music,
  Pause,
  Play,
  ScrollText,
  SlidersVertical,
  Workflow,
} from "@frediverse/ui/icons";
import { useEngineState } from "@studio/engine-browser/store";
import { m } from "./paraglide/messages.js";
import type { Pane, Panel } from "./routes";
import { formatAt } from "./shareComments";

// The panes, not tabs: a view is a LAYOUT over the same instances, and which of them a project mounts is `viewPanes` in routes.ts, not this table.
export const PANES: Pane[] = [
  "editor",
  "timeline",
  "turntables",
  "mastering",
  "chains",
];

// Max gap between the two Shift presses that open the command palette (IntelliJ style).
export const DOUBLE_SHIFT_MS = 400;

export const PANE_META: Record<Pane, { icon: LucideIcon; label: string }> = {
  editor: { icon: FileCode, label: "Editor" },
  timeline: { icon: AudioWaveform, label: "Timeline" },
  turntables: { icon: Disc3, label: "Turntables" },
  mastering: { icon: Gauge, label: "Mastering" },
  chains: { icon: Workflow, label: "Chains" },
};

// The picture's window — not a pane, so not in the table above, but drawn with the same glyph wherever a surface is listed.
export const VIEWPORT_META: { icon: LucideIcon; label: string } = {
  icon: MonitorPlay,
  label: "Viewport",
};

// No metadata for a layout: there is one, and which panes it holds is what the project declares (routes.ts).

// The bottom panels: `event` is the clip or lane opened, `graph` the caret track's path, `mix` the strips lined up, `logs` what happened.
export const PANEL_META: Record<Panel, { icon: LucideIcon; label: string }> = {
  event: { icon: Music, label: "Event" },
  graph: { icon: Workflow, label: "Graph" },
  mix: { icon: SlidersVertical, label: "Mix" },
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
  const clock = formatAt(s);
  // Position as 1-based bar:beat, clamped at 0 so a count-in's negative playhead doesn't read as a negative bar.
  const beat = Math.max(0, (s * tempo) / 60);
  const bpb = Math.max(1, beatsPerBar);
  const bar = Math.floor(beat / bpb) + 1;
  const beatInBar = Math.floor(beat % bpb) + 1;
  return (
    <span className="mx-1 whitespace-nowrap font-mono text-xs text-muted-foreground tabular-nums">
      {/* Under 380 px the bar keeps the musician's position and drops the seconds, or the clock runs under the menu. */}
      <span className="max-[380px]:hidden">
        {clock}
        <span className="mx-1 text-border">·</span>
      </span>
      {bar}:{beatInBar}
    </span>
  );
}

/** The transport reduced to what you need when the shell is hidden: play/pause and the clock, with `stop` as the pause the engine understands. */
export function MiniTransport({
  playing,
  waiting,
  tempo,
  beatsPerBar,
  onToggle,
}: {
  playing: boolean;
  /** The engine is still loading the project: it can answer no transport yet. */
  waiting: boolean;
  tempo: number;
  beatsPerBar: number;
  onToggle: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border bg-popover px-2 py-1">
      <button
        type="button"
        disabled={waiting}
        onClick={onToggle}
        title={
          waiting
            ? m["status.engineStarting"]()
            : playing
              ? m["transport.pause"]()
              : m["transport.play"]()
        }
        aria-label={
          waiting
            ? m["status.engineStarting"]()
            : playing
              ? m["transport.pause"]()
              : m["transport.play"]()
        }
        aria-busy={waiting}
        className="flex h-6 w-6 items-center justify-center rounded text-foreground hover:bg-accent disabled:opacity-50"
      >
        {waiting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : playing ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
      </button>
      <TransportClock tempo={tempo} beatsPerBar={beatsPerBar} />
    </div>
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
