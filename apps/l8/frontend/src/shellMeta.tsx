// shellMeta.tsx — the shell's static tables (panes, views, panels: icon + label) and the small
// presentational pieces built on them: the transport clock, the metronome glyph, and the
// mini transport the floating minimap carries. Extracted from App.tsx so the shell reads as
// wiring, not tables.

import { useEngineState } from "@studio/engine-browser/store";
import {
  AudioWaveform,
  FileCode,
  Loader2,
  type LucideIcon,
  MonitorPlay,
  Pause,
  Play,
  ScrollText,
  SlidersVertical,
  Workflow,
} from "lucide-react";
import { m } from "./paraglide/messages.js";
import type { Pane, Panel } from "./routes";

// The panes, not tabs: a "view" is a LAYOUT over the same instances, and the default one stacks the
// frame over the timeline over the graph. `editor` is in this list because it can be FULLSCREENED and
// toggled from the header — it just has no slot in either layout (see App's ringPanes). `viewport` is
// here for the same reason `timeline` is: both are `split` SURFACES the project declares, and which of
// them a given project actually mounts is `viewPanes` in routes.ts, not this table.
export const PANES: Pane[] = ["editor", "viewport", "timeline", "chains"];

// Max gap between the two Shift presses that open the command palette (IntelliJ style).
export const DOUBLE_SHIFT_MS = 400;

export const PANE_META: Record<Pane, { icon: LucideIcon; label: string }> = {
  editor: { icon: FileCode, label: "Editor" },
  viewport: { icon: MonitorPlay, label: "Viewport" },
  timeline: { icon: AudioWaveform, label: "Timeline" },
  chains: { icon: Workflow, label: "Chains" },
};

// `VIEW_META` was here: an icon and a label for `global` and `live`. Both layouts are gone --
// there is one, and which panes it holds is what the project declares (routes.ts).

// The bottom panels: `graph` is the caret track's path, `logs` what happened.
//
// `docs` was a third — a project's notes and to-dos in one list. A note is a doc module in the
// GRAPH now, toggled beside the mixer, so there is nothing left for a panel to aggregate.
//
// Two things left this row rather than being added to it. The MIXER is a view of the graph and
// is drawn where the graph is; its button sits beside these all the same (see App.tsx). The
// EDITOR panel drew a clip's contents, which the graph's own slot now does — the same
// `ClipView`, with the pane's height instead of a band's, so keeping the panel was showing the
// same roll twice and inviting the two to disagree.
export const PANEL_META: Record<Panel, { icon: LucideIcon; label: string }> = {
  graph: { icon: Workflow, label: "Graph" },
  logs: { icon: ScrollText, label: "Logs" },
};

/** The mixer's icon, still needed though it left PANEL_META — its button now opens a graph view. */
export const MixerIcon = SlidersVertical;

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

/**
 * The transport, reduced to what you need when the shell is hidden behind something.
 *
 * Play/pause and the clock, and deliberately nothing else: stop, rewind, record and the
 * metronome all belong to a session you are looking at, and this rides over a popin that is
 * covering it. One BUTTON for the two states, as the header's does — and it sends `stop` to
 * pause, because that is what the engine understands and having two spellings of pause in one
 * app is how they come to disagree.
 */
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
