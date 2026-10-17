// ShellFooter.tsx — the bar under the panes: on the left the mode badges, the status line and
// what the shell is waiting on; on the right the tempo, the metronome, the notes toggle and the
// bottom and side panels' buttons. Every button runs a command, never a handler (docs/shell.md).

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { Loader2, StickyNote } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { askText } from "@studio/project-shell/ask";
import type { ReactNode } from "react";
import { EngineSyncProgress } from "../components/EngineSyncProgress";
import { FooterTab, FooterTabs } from "../components/FooterTab";
import { MetronomeButton } from "../components/MetronomeButton";
import { StatusText } from "../components/StatusText";
import type { useWarmWaveforms } from "../hooks/usePolls";
import type { RecInfo } from "../hooks/useProjectDoc";
import { m } from "../paraglide/messages.js";
import type { RollMode } from "../rollMode";
import type { Pane, Panel } from "../routes";
import { PANEL_META } from "../shellMeta";
import type { createStatusLine } from "../statusLine";
import type { TimelineMode } from "../timelineMode";
import type { Tool } from "../timelineTools";
import type { EngineSyncState, FormatTooNew } from "../types";
import type { GraphSlot } from "../ui/commands/context";
import type { WaveMode } from "../waveMode";

export function ShellFooter({
  isMobile,
  rollMode,
  waveView,
  shownSlot,
  ringPanes,
  tlView,
  statusStore,
  statusFallback,
  copyingToEngine,
  engineSync,
  waitingForEngine,
  warm,
  projectErrors,
  formatTooNew,
  recInfo,
  optMetronome,
  setOptMetronome,
  metronomeOn,
  metronomeLevel,
  runCommand,
  showDocs,
  docCount,
  panel,
  mixerStrips,
  headerTools,
}: {
  isMobile: boolean;
  rollMode: RollMode | null;
  waveView: WaveMode | null;
  shownSlot: GraphSlot | null;
  ringPanes: Pane[];
  tlView: { mode: TimelineMode; tool: Tool };
  statusStore: ReturnType<typeof createStatusLine>;
  /** What the status line says when nothing has been said — the project's root. */
  statusFallback: string | undefined;
  copyingToEngine: boolean;
  engineSync: EngineSyncState | null;
  waitingForEngine: boolean;
  warm: ReturnType<typeof useWarmWaveforms>;
  projectErrors: number;
  /** Set when the project was written by a newer k7: the badge then says to update rather than counting errors. */
  formatTooNew: FormatTooNew | null;
  recInfo: RecInfo;
  /** The metronome as last clicked, ahead of the document that will confirm it. */
  optMetronome: boolean | null;
  setOptMetronome: (next: (cur: boolean | null) => boolean) => void;
  metronomeOn: boolean;
  metronomeLevel: number;
  runCommand: (line: string) => Promise<void>;
  showDocs: boolean;
  docCount: number;
  panel: Panel | null;
  mixerStrips: string[];
  /** The side panels' buttons, drawn here on a desktop and in the menu on a phone. */
  headerTools: ReactNode;
}) {
  return (
    <footer
      className={cn(
        // The header's tint, so the panel tabs read as tabs against it (components/FooterTab.tsx).
        "flex items-center border-t border-primary/20 bg-primary/20 text-muted-foreground",
        isMobile ? "gap-2 px-2 py-0.5 text-[10px]" : "gap-3 px-4 py-1 text-xs",
      )}
    >
      {/* left: the frediverse logo, then the status text */}
      <div className="flex min-w-0 items-center gap-2.5">
        <FrediverseMark size="sm" className="shrink-0 opacity-60" />
        {/* The MODE and the tool, PERSISTENT unlike the line beside it: a state nobody can see is one you leave by surprise (docs/timeline.md). */}
        {/* The waveform's comes FIRST when one is open, the clip pane being the surface in front. */}
        {rollMode && shownSlot?.kind === "clip" ? (
          rollMode !== "select" && (
            <Badge
              variant="rec"
              className="shrink-0"
              title={`piano roll: ${rollMode} — esc or a backs out`}
            >
              {rollMode}
            </Badge>
          )
        ) : waveView && shownSlot?.kind === "clip" ? (
          waveView !== "standard" && (
            <Badge
              variant="rec"
              className="shrink-0"
              title={`waveform: ${waveView} — esc or a backs out`}
            >
              {waveView}
            </Badge>
          )
        ) : ringPanes.includes("timeline") &&
          (tlView.mode !== "normal" || tlView.tool !== "pointer") ? (
          <Badge
            variant={tlView.tool !== "pointer" ? "rec" : "default"}
            className="shrink-0"
            title={`timeline: ${tlView.mode}${tlView.tool !== "pointer" ? ` · ${tlView.tool}` : ""} — esc backs out`}
          >
            {tlView.tool !== "pointer" ? tlView.tool : tlView.mode}
          </Badge>
        ) : null}
        <StatusText store={statusStore} fallback={statusFallback} />
        {/* The play button spins for this too; the line stays because it NAMES what is awaited, which a spinner cannot. */}
        {copyingToEngine && engineSync ? (
          <EngineSyncProgress sync={engineSync} />
        ) : waitingForEngine ? (
          <span
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-amber-500"
            title={m["status.engineStarting"]()}
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            waiting for engine…
          </span>
        ) : warm.warming ? (
          <span
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"
            title={m["status.decodingWaveforms"]()}
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            caching waveforms
            {warm.total ? ` ${warm.done}/${warm.total}` : ""}…
          </span>
        ) : null}
        {formatTooNew ? (
          <Badge
            variant="rec"
            className="min-w-0 truncate"
            title={m["project.formatTooNew"](formatTooNew)}
          >
            {m["project.formatTooNew"](formatTooNew)}
          </Badge>
        ) : (
          projectErrors > 0 && (
            <Badge
              variant="rec"
              className="shrink-0"
              title={`${projectErrors} error${projectErrors === 1 ? "" : "s"} in this project — the timeline and chains won't load until they're fixed`}
            >
              {projectErrors} error{projectErrors === 1 ? "" : "s"}
            </Badge>
          )
        )}
      </div>

      {/* right: the tempo and signature, the metronome, a separator, then the bottom-panel choices, a separator, then the side panels' buttons */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Next to the metronome because it is what the metronome clicks — the doc's tempo, not the engine's. */}
        {/* Each number edits itself on a click, through the commands that write project.yaml (`project tempo`, `project meter`). */}
        <span className="flex items-center whitespace-nowrap font-mono tabular-nums">
          <button
            type="button"
            className="rounded px-0.5 hover:bg-accent hover:text-foreground"
            title={m["transport.tempoEdit"]()}
            onClick={() =>
              void askText({
                title: m["transport.tempoAsk"](),
                initial: String(recInfo.tempo),
                validate: (v) =>
                  Number(v) >= 20 && Number(v) <= 400
                    ? ""
                    : m["transport.tempoBad"](),
              }).then((v) => {
                if (v) void runCommand(`project tempo ${v.trim()}`);
              })
            }
          >
            {recInfo.tempo} bpm
          </button>
          <span className="mx-1 text-border">·</span>
          <button
            type="button"
            className="rounded px-0.5 hover:bg-accent hover:text-foreground"
            title={m["transport.meterEdit"]()}
            onClick={() =>
              void askText({
                title: m["transport.meterAsk"](),
                initial: `${recInfo.beatsPerBar}/${recInfo.beatUnit}`,
                validate: (v) =>
                  /^\d+\/(1|2|4|8|16|32)$/.test(v.trim())
                    ? ""
                    : m["transport.meterBad"](),
              }).then((v) => {
                if (v) void runCommand(`project meter ${v.trim()}`);
              })
            }
          >
            {recInfo.beatsPerBar}/{recInfo.beatUnit}
          </button>
        </span>
        {/* Left click toggles the click, right click opens its level; both are project settings, so both are command lines. */}
        <MetronomeButton
          on={optMetronome ?? metronomeOn}
          level={metronomeLevel}
          onToggle={() => {
            setOptMetronome((cur) => !(cur ?? metronomeOn));
            void runCommand("transport metronome");
          }}
          onLevel={(v) => void runCommand(`transport metronome volume ${v}`)}
        />
        <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
        {/* The notes, off by default: they are IN the graph and you say when, and the button is dead on a project with none. */}
        <Button
          size="icon-xs"
          variant={showDocs ? "default" : "ghost"}
          disabled={docCount === 0}
          onClick={() => void runCommand("ui notes")}
          title={
            docCount === 0
              ? "No notes in this project: a note is a node of @meta/doc, wired from what it is about"
              : showDocs
                ? `Hide the ${docCount} note(s) on the graph`
                : `Show the ${docCount} note(s) on the graph`
          }
          aria-label="Toggle docs"
          aria-pressed={showDocs}
        >
          <StickyNote className="h-3.5 w-3.5" />
        </Button>
        <FooterTabs dense={isMobile}>
          {/* The mix panel, apart from the loop below because it is dead when the song has no strip (docs/shell.md). */}
          <FooterTab
            active={panel === "mix"}
            disabled={mixerStrips.length === 0}
            onClick={() => void runCommand("ui mixer")}
            title={
              mixerStrips.length === 0
                ? "No strip in this song: a strip is a Mixer module at the end of a track"
                : mixerStrips.length === 1
                  ? "Mix panel — one strip, nothing to line up"
                  : `Mix panel — this song's ${mixerStrips.length} strips lined up`
            }
            aria-label="Mix panel"
          >
            <PANEL_META.mix.icon className="h-3.5 w-3.5" />
          </FooterTab>
          {(Object.keys(PANEL_META) as Panel[]).map((p) => {
            if (p === "mix") return null;
            const Icon = PANEL_META[p].icon;
            return (
              <FooterTab
                key={p}
                active={panel === p}
                onClick={() => void runCommand(`ui panel ${p}`)}
                title={`${PANEL_META[p].label} panel`}
                aria-label={`${PANEL_META[p].label} panel`}
              >
                <Icon className="h-3.5 w-3.5" />
              </FooterTab>
            );
          })}
        </FooterTabs>
        {/* The SIDE panels' buttons, at the corner nearest the column they open — a phone keeps them in its menu (docs/shell.md). */}
        {!isMobile && (
          <>
            <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
            <FooterTabs>{headerTools}</FooterTabs>
          </>
        )}
      </div>
    </footer>
  );
}
