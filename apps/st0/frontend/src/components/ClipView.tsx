// ClipView.tsx — a clip's CONTENT: the AudioClipPanel for audio, the piano roll for MIDI, and for
// a live sequence FILE the roll of the notes parsed out of its text. Each draws its own header and
// close button. Two hosts mount it — the Editor bottom panel, and the graph slot when a clip is
// clicked in the timeline (see docs/shell.md). There is ONE audio clip panel, and clicking a clip
// reaches it: `WaveformView` draws the same picture and can act on none of it.

import { Grid3x3 } from "@frediverse/ui/icons";
import { DEFAULT_METRONOME_LEVEL } from "@studio/engine-protocol/build";
import type { WebGraph } from "@studio/graph-model";
import { seqWindowFromText, windowSpan } from "@studio/song-schema/seqWindow";
import { beatsToPosition } from "@studio/song-schema/timecode";
import { findNotesArray, parseNotes } from "@studio/ui-editor/tracker/notes";
import { type RefObject, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { MenuCtx } from "../contextMenu";
import type { ClipGridHandle, OnGridSelection } from "../gridCaret";
import { m } from "../paraglide/messages.js";
import { fileStem } from "../projectPaths";
import { rackFor, rackKeyNames } from "../rackFor";
import type { RollMode } from "../rollMode";
import { trackPlacing } from "../rows";
import { eventIdOf, takesEventOf } from "../takes";
import type { Hints, WebClip, WebNote, WebProject } from "../types";
import type { WaveMode } from "../waveMode";
import { type AudioClipHandle, AudioClipPanel } from "./AudioClipPanel";
import { type ClipViewMode, ClipViewModes } from "./ClipViewModes";
import { GraphSlotPane } from "./GraphSlotPane";
import { PianoRoll, type RollHandle } from "./PianoRoll";
import { SeqGridFile } from "./SeqGridFile";
import { SequencerPanel } from "./SequencerPanel";
import type { PanelTakes, TakesHost } from "./TakesView";

// What to show: a concrete clip (timeline caret or click), or the live sequence file open in the editor, parsed here.
export type EditTarget =
  // `track` when the opener knows the lane: a duplicated lane holds clips with the SAME ids as its original.
  | { kind: "clip"; project: WebProject; clip: WebClip; track?: string }
  | { kind: "seq"; path: string; content: string };

// Enough of a project for the roll (tempo + time signature) until the real doc loads, so a sequence still previews.
const FALLBACK_PROJECT: WebProject = {
  name: "",
  tempo: 120,
  timeSigNumerator: 4,
  timeSigDenominator: 4,
  masterVolume: 0, // unity — a stand-in draws no fader, and a roll asks nothing of it
  tracks: [],
  groups: [],
  metronome: false,
  metronomeLevel: DEFAULT_METRONOME_LEVEL,
  countIn: 0,
  markers: [],
};

// The live sequence file's notes as a roll, re-parsed as the text changes — parsing is local and cheap.
function SeqRoll({
  path,
  content,
  onCreateNote,
  onSetVelocity,
  onSetNoteRange,
  onMoveNote,
  onMoveNotes,
  onContextMenu,
}: {
  path: string;
  content: string;
  onCreateNote?: (
    seqId: string,
    key: number,
    t0: number,
    t1: number,
  ) => void | Promise<void>;
  onSetVelocity?: (
    seqId: string,
    key: number,
    startBeat: number,
    vel: number,
  ) => void | Promise<void>;
  /** Move or stretch a note (`sequence note timerange`): where it starts NOW, then where it should start and end. */
  onSetNoteRange?: (
    seqId: string,
    key: number,
    startBeat: number,
    newStart: number,
    newEnd: number,
  ) => void | Promise<void>;
  /** Move a note to another PITCH (`sequence note move`), which keeps its duration. */
  onMoveNote?: (
    seqId: string,
    key: number,
    startBeat: number,
    newKey: number,
    newStart: number,
  ) => void | Promise<void>;
  /** Move SEVERAL notes in one write (`sequence notes move`): each [key, start, newKey, newStart] — the roll's dragged selection. */
  onMoveNotes?: (
    seqId: string,
    moves: [number, number, number, number][],
  ) => void | Promise<void>;
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
}) {
  const [project, setProject] = useState<WebProject | null>(null);

  useEffect(() => {
    void api
      .projectDoc()
      .then(setProject)
      .catch(() => {});
  }, []);

  const notes = useMemo<WebNote[]>(() => {
    const span = findNotesArray(content);
    if (!span) return [];
    return parseNotes(content.slice(span.from, span.to)).map((n) => ({
      time: n.t,
      duration: n.d,
      key: n.k,
      // Only what the file states, as the compiled path does: absent IS the default 1.
      ...(n.v === undefined ? {} : { vel: n.v }),
    }));
  }, [content]);

  const name = fileStem(path) || "sequence";
  /** The file's own `from`/`to` as the roll's loop pair — for MIDI that IS the window (clipLoop.ts); the default `to` rounds UP TO THE BAR. */
  const loop = useMemo(() => {
    const num = project?.timeSigNumerator ?? 4;
    const den = project?.timeSigDenominator ?? 4;
    const win = seqWindowFromText(content, num, den);
    if (!win) return null;
    const bar = (num * 4) / den;
    const extent =
      Math.ceil(
        notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0) / bar,
      ) * bar;
    return windowSpan(win, extent);
  }, [content, notes, project]);
  const clip: WebClip = {
    id: path,
    type: "midi",
    name,
    start: 0,
    length: 0,
    ...(loop ? { loopStart: loop.from, loopEnd: loop.to } : {}),
    notes,
  };

  return (
    <div className="h-full min-h-0">
      <PianoRoll
        project={project ?? FALLBACK_PROJECT}
        clip={clip}
        onCreateNote={
          onCreateNote
            ? (k, t0, t1) => onCreateNote(name, k, t0, t1)
            : undefined
        }
        onSetVelocity={
          onSetVelocity ? (k, t, v) => onSetVelocity(name, k, t, v) : undefined
        }
        onSetNoteRange={
          onSetNoteRange
            ? (k, t, ns, ne) => onSetNoteRange(name, k, t, ns, ne)
            : undefined
        }
        onMoveNote={
          onMoveNote
            ? (k, t, nk, ns) => onMoveNote(name, k, t, nk, ns)
            : undefined
        }
        onMoveNotes={
          onMoveNotes ? (moves) => onMoveNotes(name, moves) : undefined
        }
        onContextMenu={onContextMenu}
      />
    </div>
  );
}

export function ClipView({
  target,
  onClose,
  reloadKey = 0,
  onSeek,
  command,
  quietCommand,
  onContextMenu,
  onChanged,
  setStatus,
  caretRef,
  onSelection,
  onSetLoop,
  onCreateNote,
  onSetVelocity,
  onSetNoteRange,
  onMoveNote,
  onMoveNotes,
  onPreviewNote,
  onRemoveNote,
  waveRef,
  onWaveView,
  rollRef,
  onRollMode,
  takesHost,
}: {
  target: EditTarget;
  onClose: () => void;
  /** Where the shell reaches this pane's CARET — forwarded to whichever grid is drawn; the tracker gets none, being CodeMirror. */
  caretRef?: RefObject<ClipGridHandle | null>;
  /** Whether the drawn grid has a rectangle — what makes ⇧L conditional (see OnGridSelection). */
  onSelection?: OnGridSelection;
  /** Set or clear the transport's loop region, in SONG seconds — Shift+L on a rectangle. */
  onSetLoop?: (fromSec: number, toSec: number, on: boolean) => void;
  /** Bumped by the shell after every command's reload — what keeps the open clip FRESH below. */
  reloadKey?: number;
  /** A write landed outside the command journal — the TRACKER writes its file directly, and the timeline draws the same notes. */
  onChanged?: () => void;
  /** Where a failed write is reported — only the tracker has one, the other two writing through `command`. */
  setStatus?: (s: string) => void;
  /** Seek the transport, in SONG seconds — what a click on a clip editor's arrangement ruler does. */
  onSeek?: (seconds: number) => void;
  /** Runs a command line through the shell, which journals it — a note edit takes the callbacks below instead. */
  command: (line: string) => void | Promise<void>;
  /** …and the same without the shell-wide reload, for an edit confined to one clip. */
  quietCommand?: (line: string) => void | Promise<void>;
  /** The shell's right-click menu — the waveform's stretch points, a sequencer pad, a roll note. Absent ⇒ the browser's own. */
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  // Draw a note into a sequence: (seqId, key, startBeat, endBeat). Runs `sequence note new`.
  onCreateNote?: (
    seqId: string,
    key: number,
    t0: number,
    t1: number,
  ) => void | Promise<void>;
  // Set one note's velocity: (seqId, key, startBeat, 0..1). Runs `sequence note velocity`.
  onSetVelocity?: (
    seqId: string,
    key: number,
    startBeat: number,
    vel: number,
  ) => void | Promise<void>;
  /** Move or stretch a note (`sequence note timerange`): where it starts NOW, then where it should start and end. */
  onSetNoteRange?: (
    seqId: string,
    key: number,
    startBeat: number,
    newStart: number,
    newEnd: number,
  ) => void | Promise<void>;
  /** Move a note to another PITCH (`sequence note move`), which keeps its duration — the roll's vertical drag. */
  onMoveNote?: (
    seqId: string,
    key: number,
    startBeat: number,
    newKey: number,
    newStart: number,
  ) => void | Promise<void>;
  /** Move SEVERAL notes in one write (`sequence notes move`): each [key, start, newKey, newStart] — the roll's dragged selection. */
  onMoveNotes?: (
    seqId: string,
    moves: [number, number, number, number][],
  ) => void | Promise<void>;
  /** Hear one note through a TRACK's chain — over the engine's socket, not through a command; the track is found here. */
  onPreviewNote?: (track: string, key: number, vel: number) => void;
  /** Remove one note (`sequence note remove`) — the roll's `remove` mode, and the caret's `x` by another road. */
  onRemoveNote?: (
    seqId: string,
    key: number,
    startBeat: number,
  ) => void | Promise<void>;
  /** The AUDIO leaf's mode, the counterpart of `caretRef` for the three grids — `ui wave <mode>` arrives through it. */
  waveRef?: RefObject<AudioClipHandle | null>;
  onWaveView?: (v: WaveMode | null) => void;
  /** …and the ROLL's, the third of the three — `ui roll <mode>`. */
  rollRef?: RefObject<RollHandle | null>;
  onRollMode?: (m: RollMode | null) => void;
  /** The takes mode's shell half — absent, neither panel offers the mode a record button (song docs/takes.md). */
  takesHost?: TakesHost;
}) {
  /** The open clip, kept FRESH: `target` is a snapshot from the click, and the placement is found again by (id, start). */
  const [freshProject, setFreshProject] = useState<WebProject | null>(null);
  useEffect(() => {
    if (target.kind === "seq") return void setFreshProject(null);
    let cancelled = false;
    void api
      .projectDoc()
      .then((p) => !cancelled && setFreshProject(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reloadKey, target]);
  const clip = useMemo(() => {
    if (target.kind === "seq") return null;
    const base = target.clip;
    for (const t of freshProject?.tracks ?? [])
      for (const c of [...(t.clips ?? []), ...(t.frozenMaterial ?? [])])
        if (c.id === base.id && Math.abs(c.start - base.start) < 1e-6) return c;
    return base;
  }, [target, freshProject]);
  const project =
    target.kind === "seq" ? null : (freshProject ?? target.project);
  // The EVENT the open clip belongs to, by its own id: a re-comp can replace the very piece that was clicked.
  const takes = useMemo((): PanelTakes | undefined => {
    if (target.kind === "seq" || !project || !takesHost) return undefined;
    const track = target.track || trackPlacing(target.project, target.clip.id);
    const ev = track
      ? takesEventOf(project, track, eventIdOf(target.clip))
      : null;
    return ev
      ? {
          host: takesHost,
          ev,
          num: project.timeSigNumerator,
          den: project.timeSigDenominator,
        }
      : undefined;
  }, [target, project, takesHost]);
  const seqId = clip ? clip.name || clip.id : "";
  /** A MIDI clip whose track feeds a RACK opens as a STEP SEQUENCER; a graph that will not BUILD is kept apart from one naming no rack. */
  const midiTrack =
    target.kind !== "seq" && target.clip.type === "midi"
      ? target.track || trackPlacing(target.project, target.clip.id)
      : "";
  /** The event as the `event …` verbs address it — lane and start — or null for a roll that shows no placement. */
  const eventAddr =
    clip && midiTrack && clip.length > 0 && target.kind !== "seq"
      ? `${midiTrack} ${beatsToPosition(
          clip.start,
          (project ?? target.project).timeSigNumerator,
          (project ?? target.project).timeSigDenominator,
        )}`
      : null;
  const [graph, setGraph] = useState<WebGraph | null | undefined>(undefined);
  const [graphError, setGraphError] = useState<string | null>(null);
  /** WHICH view of these notes, reset per clip: every clip opens on the roll, and the header's dropdown moves it from there. */
  const [mode, setMode] = useState<ClipViewMode>("roll");
  useEffect(() => {
    setGraphError(null);
    setMode("roll");
    if (!midiTrack) return void setGraph(null);
    let cancelled = false;
    setGraph(undefined);
    void api
      .graph()
      .then((g) => !cancelled && setGraph(g))
      .catch((e: Error) => {
        if (cancelled) return;
        setGraphError(e.message || "graphe illisible");
        setGraph(null);
      });
    return () => {
      cancelled = true;
    };
  }, [midiTrack, clip?.id]);
  const rack = midiTrack ? rackFor(graph ?? null, midiTrack) : null;
  // The roll names a rack's keys after their samples; a lane with no rack keeps note names alone.
  const keyNames = useMemo(
    () => (rack ? rackKeyNames(rack) : undefined),
    [rack],
  );
  // The sequencer needs a rack: with none there is no grid to draw, so a pick of it falls to the roll.
  const view: ClipViewMode = mode === "sequencer" && !rack ? "roll" : mode;

  /** The TRACKER edits the sequence FILE, so it needs `/hints` — asked only once a tracker is, and on `reloadKey` too. */
  const [hints, setHints] = useState<Pick<Hints, "paths" | "racks"> | null>(
    null,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is a TRIGGER, not a value this body reads — dropping it is exactly the "a sequence made since the pane opened has no path" bug.
  useEffect(() => {
    if (view !== "tracker") return;
    let cancelled = false;
    void api
      .hints()
      .then((h) => !cancelled && setHints(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [view, reloadKey]);
  const seqPath = hints?.paths[`sequence:${seqId}`] ?? null;

  const modes = (
    <ClipViewModes value={view} onChange={setMode} sequencer={!!rack} />
  );
  // No title bar: each of the three leaves draws its own header, and the frame contributes the shell and one floating ✕.
  return (
    <GraphSlotPane>
      {target.kind === "seq" ? (
        <SeqRoll
          path={target.path}
          content={target.content}
          onCreateNote={onCreateNote}
          onSetVelocity={onSetVelocity}
          onSetNoteRange={onSetNoteRange}
          onMoveNote={onMoveNote}
          onMoveNotes={onMoveNotes}
          onContextMenu={onContextMenu}
        />
      ) : clip?.type === "midi" ? (
        graph === undefined ? (
          <div className="p-3 text-sm text-muted-foreground">
            {m["clipv.readingGraph"]()}
          </div>
        ) : rack && view === "sequencer" ? (
          <SequencerPanel
            project={project ?? target.project}
            clip={clip}
            rack={rack}
            modes={modes}
            command={command}
            // The caret is the DRAWN grid's, so the ref and `active` go to whichever of the two is on screen.
            caretRef={caretRef}
            active
            setStatus={setStatus}
            onSelection={onSelection}
            onSeek={onSeek}
            onSetLoop={onSetLoop}
            // …and the same right-click every other entity has, here for a pad's effects.
            onContextMenu={onContextMenu}
            onPreviewNote={
              onPreviewNote && midiTrack
                ? (k, v) => onPreviewNote(midiTrack, k, v)
                : undefined
            }
          />
        ) : view === "tracker" ? (
          // The tracker over the sequence FILE, headed the way the other two are; it writes straight to the file (SeqGridFile.tsx).
          <div className="flex h-full min-h-0 flex-col border-t-2 border-border">
            <div className="flex items-center gap-2 border-border border-b px-3 py-1 text-xs">
              <span className="font-semibold text-primary">
                <Grid3x3 className="h-3.5 w-3.5" /> {seqId}
              </span>
              <span className="truncate text-muted-foreground">
                {seqPath ?? "…"}
              </span>
              <span className="ml-auto">{modes}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {hints && !seqPath ? (
                // The clip names no sequence file of this project — said, rather than shown as an empty grid.
                <div className="p-3 text-muted-foreground text-sm">
                  {m["clipv.noSeqFile"]({ seq: seqId })}
                </div>
              ) : seqPath ? (
                <SeqGridFile
                  path={seqPath}
                  view="tracker"
                  racks={hints?.racks ?? {}}
                  onChanged={onChanged ?? (() => {})}
                  setStatus={setStatus ?? (() => {})}
                  reloadKey={reloadKey}
                />
              ) : (
                <div className="p-3 text-muted-foreground text-sm">
                  {m["clipv.readingProject"]()}
                </div>
              )}
            </div>
          </div>
        ) : (
          // The roll, and above it the reason the sequencer is not here: the failure is reported beside the work, not in place of it.
          <div className="flex h-full min-h-0 flex-col">
            {graphError && (
              <div
                className="shrink-0 whitespace-pre-wrap border-amber-500/40 border-b bg-amber-500/10 px-3 py-1 text-amber-300 text-xs"
                title={m["clipv.needsGraph"]()}
              >
                pas de séquenceur : le graphe ne se construit pas — {graphError}
              </div>
            )}
            {/* The roll's root is `h-full`, so it gets a box to be the whole of and the notice takes its height off the top. */}
            <div className="min-h-0 min-w-0 flex-1">
              <PianoRoll
                project={project ?? target.project}
                clip={clip}
                keyNames={keyNames}
                modes={modes}
                caretRef={caretRef}
                active
                setStatus={setStatus}
                onSelection={onSelection}
                onSetLoop={onSetLoop}
                // The EVENT's own loop, which only a placement has: the switch, and its two points in the notes' beats.
                onLoop={
                  eventAddr
                    ? (on) =>
                        void command(
                          `event loop ${eventAddr} ${on ? "on" : "off"}`,
                        )
                    : undefined
                }
                onLoopPoints={
                  eventAddr
                    ? (f, t) =>
                        void command(
                          `event loop points ${eventAddr} ${f.toFixed(4)} ${t.toFixed(4)}`,
                        )
                    : undefined
                }
                onSeek={onSeek}
                onCreateNote={
                  onCreateNote
                    ? (k, t0, t1) => onCreateNote(seqId, k, t0, t1)
                    : undefined
                }
                onSetVelocity={
                  onSetVelocity
                    ? (k, t, v) => onSetVelocity(seqId, k, t, v)
                    : undefined
                }
                onSetNoteRange={
                  onSetNoteRange
                    ? (k, t, ns, ne) => onSetNoteRange(seqId, k, t, ns, ne)
                    : undefined
                }
                onMoveNote={
                  onMoveNote
                    ? (k, t, nk, ns) => onMoveNote(seqId, k, t, nk, ns)
                    : undefined
                }
                onMoveNotes={
                  onMoveNotes ? (moves) => onMoveNotes(seqId, moves) : undefined
                }
                onContextMenu={onContextMenu}
                // A sequence FILE has no placement, so no chain to hear it through: the roll is then silent, and honestly so.
                onPreviewNote={
                  onPreviewNote && midiTrack
                    ? (k, v) => onPreviewNote(midiTrack, k, v)
                    : undefined
                }
                onRemoveNote={
                  onRemoveNote ? (k, t) => onRemoveNote(seqId, k, t) : undefined
                }
                // The roll's mode: down from the shell so a key reaches it, up so a condition and the badge can read it.
                onCommand={command}
                modeRef={rollRef}
                onModeChange={onRollMode}
                takes={takes}
                reloadKey={reloadKey}
              />
            </div>
          </div>
        )
      ) : (
        // An audio event opens the CLIP PANEL — the same one a take lands in, with its onsets, its trim and its normalise.
        clip && (
          <AudioClipPanel
            onContextMenu={onContextMenu}
            quietCommand={quietCommand}
            // So a stretch point dropped from the right-click menu — which runs through the SHELL — is gone from the picture too.
            reloadKey={reloadKey}
            clip={clip.id}
            track={
              (target.kind === "clip" && target.clip.id === clip.id
                ? target.track
                : undefined) || trackPlacing(project ?? target.project, clip.id)
            }
            // The project's own, so the twelve-bar window is twelve of THIS song's bars.
            tempo={(project ?? target.project).tempo}
            beatsPerBar={(project ?? target.project).timeSigNumerator}
            // The clicked EVENT's beat — what puts the song's ruler over the wave.
            placedAt={clip.start}
            // …and the same beat as a TIMECODE, spelled HERE because it needs the project's time signature, denominator included.
            eventAt={beatsToPosition(
              clip.start,
              (project ?? target.project).timeSigNumerator,
              (project ?? target.project).timeSigDenominator,
            )}
            // …and the slice of the file it plays, already the intersection the compiler made (nodeProject.ts).
            eventWindow={{ from: clip.sourceFrom, to: clip.sourceTo }}
            // …and how many times it plays it: more than one is a loop, which the panel's switch and ruler edit.
            loops={clip.event?.loop ?? 1}
            // …and its own trim, which only an audio event has.
            gainDb={clip.event?.gain ?? 0}
            onSeek={onSeek}
            command={command}
            onClose={onClose}
            // The waveform's mode: down from the shell so a key reaches it, up so a condition and the badge can read it.
            viewRef={waveRef}
            onViewChange={onWaveView}
            setStatus={setStatus}
            takes={takes}
          />
        )
      )}
    </GraphSlotPane>
  );
}
