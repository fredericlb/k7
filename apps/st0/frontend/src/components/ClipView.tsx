// ClipView.tsx — a clip's CONTENT: the AudioClipPanel for audio, the piano roll for MIDI, and for
// a live sequence FILE the roll of the notes parsed out of its text. Each draws its own header and
// close button. Two hosts mount it — the Editor bottom panel, and the graph slot when a clip is
// clicked in the timeline (see docs/shell.md).
//
// Audio used to open `WaveformView`, which draws the same picture and can act on none of it. There
// is one audio clip panel now, and clicking a clip reaches it.

import { DEFAULT_METRONOME_LEVEL } from "@studio/engine-protocol/build";
import type { WebGraph } from "@studio/graph-model";
import { seqWindowFromText, windowSpan } from "@studio/song/seqWindow";
import { beatsToPosition } from "@studio/song/timecode";
import { findNotesArray, parseNotes } from "@studio/ui-editor/tracker/notes";
import { type RefObject, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { MenuCtx } from "../contextMenu";
import type { ClipGridHandle, OnGridSelection } from "../gridCaret";
import { fileStem } from "../projectPaths";
import { rackFor } from "../rackFor";
import { trackPlacing } from "../takeReview";
import type { Hints, WebClip, WebNote, WebProject } from "../types";
import { AudioClipPanel } from "./AudioClipPanel";
import { type ClipViewMode, ClipViewModes } from "./ClipViewModes";
import { GraphSlotPane } from "./GraphSlotPane";
import { PianoRoll } from "./PianoRoll";
import { SeqGridFile } from "./SeqGridFile";
import { SequencerPanel } from "./SequencerPanel";

// What to show: a concrete clip (timeline caret or click), or the live sequence file open in the
// editor, parsed here.
export type EditTarget =
  | { kind: "clip"; project: WebProject; clip: WebClip }
  | { kind: "seq"; path: string; content: string };

// Enough of a project for the roll (tempo + time signature) until the real doc loads, so a sequence still previews.
const FALLBACK_PROJECT: WebProject = {
  name: "",
  tempo: 120,
  timeSigNumerator: 4,
  timeSigDenominator: 4,
  masterVolume: 0, // unity — a stand-in draws no fader, and a roll asks nothing of it
  strudel: false,
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
}: {
  path: string;
  content: string;
  onCreateNote?: (seqId: string, key: number, t0: number, t1: number) => void;
  onSetVelocity?: (
    seqId: string,
    key: number,
    startBeat: number,
    vel: number,
  ) => void;
  /** Move or stretch a note (`sequence note timerange`) — the same shape with one argument more:
   *  where it starts NOW, then where it should start and end. */
  onSetNoteRange?: (
    seqId: string,
    key: number,
    startBeat: number,
    newStart: number,
    newEnd: number,
  ) => void;
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
  /**
   * The file's own `from`/`to`, as the roll's loop pair — which for MIDI IS the window: the compiler
   * states it in the notes' own beats, and `clipLoop` reads it on that axis (see clipLoop.ts).
   *
   * Handed over here because this roll is built from TEXT and nothing else was carrying it: a
   * sequence opened as a file went through no compiler, so its window was dropped at the parse
   * rather than at the draw, and the pane looked identical whatever the file said.
   *
   * The default `to` is the notes' extent rounded UP TO THE BAR, the same rule `nodeProject` uses —
   * a pattern whose last hit falls on the fourth sixteenth is still two bars long.
   */
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
}: {
  target: EditTarget;
  onClose: () => void;
  /**
   * Where the shell reaches this pane's CARET — `v`, `t` and Shift+L, which are commands and so
   * arrive from the command bar rather than from a key handler.
   *
   * Forwarded straight to whichever of the two grids is drawn, so the shell holds one ref and
   * never has to know which view a clip opened in. The tracker gets none: it is CodeMirror, and
   * its cursor is its own (see SeqGridFile).
   */
  caretRef?: RefObject<ClipGridHandle | null>;
  /** Whether the drawn grid has a rectangle — what makes ⇧L conditional (see OnGridSelection). */
  onSelection?: OnGridSelection;
  /** Set or clear the transport's loop region, in SONG seconds — Shift+L on a rectangle. */
  onSetLoop?: (fromSec: number, toSec: number, on: boolean) => void;
  /** Bumped by the shell after every command's reload — what keeps the open clip FRESH below. */
  reloadKey?: number;
  /** A write landed outside the command journal — the TRACKER writes its file directly, and the
   *  timeline draws the same notes. Absent, the tracker still edits; nothing else re-reads. */
  onChanged?: () => void;
  /** Where a failed write is reported. Only the tracker has one — the other two views write
   *  through `command`, which reports its own. */
  setStatus?: (s: string) => void;
  /** Seek the transport, in SONG seconds — what a click on a clip editor's arrangement ruler
   *  does. Threaded to both editors; a sequence FILE has no placement and draws no such ruler. */
  onSeek?: (seconds: number) => void;
  /** Runs a command line through the shell, which journals it — what the audio clip panel's
   *  onsets, trim and normalise go through. A note edit takes the callbacks below instead, because
   *  those existed first and the roll builds its own lines. */
  command: (line: string) => void | Promise<void>;
  /** …and the same without the shell-wide reload, for an edit confined to one clip. */
  quietCommand?: (line: string) => void | Promise<void>;
  /** The shell's right-click menu, for the waveform's stretch points. Absent ⇒ the browser's own. */
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  // Draw a note into a sequence: (seqId, key, startBeat, endBeat). Runs `sequence note new`.
  onCreateNote?: (seqId: string, key: number, t0: number, t1: number) => void;
  // Set one note's velocity: (seqId, key, startBeat, 0..1). Runs `sequence note velocity`.
  onSetVelocity?: (
    seqId: string,
    key: number,
    startBeat: number,
    vel: number,
  ) => void;
  /** Move or stretch a note (`sequence note timerange`) — the same shape with one argument more:
   *  where it starts NOW, then where it should start and end. */
  onSetNoteRange?: (
    seqId: string,
    key: number,
    startBeat: number,
    newStart: number,
    newEnd: number,
  ) => void;
}) {
  /**
   * The open clip, kept FRESH. `target` is a snapshot taken at the click, and the panels write
   * through commands whose reload lands in the shell — without re-reading here, the sequencer
   * lit nothing it wrote and the roll drew every drag snapping back. The placement is found
   * again by (id, start), the pair a placement is addressed by everywhere; gone (deleted in
   * another tab, moved) it falls back to the snapshot rather than to a blank pane.
   */
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
      for (const c of t.clips ?? [])
        if (c.id === base.id && Math.abs(c.start - base.start) < 1e-6) return c;
    return base;
  }, [target, freshProject]);
  const project =
    target.kind === "seq" ? null : (freshProject ?? target.project);
  const seqId = clip ? clip.name || clip.id : "";
  /**
   * A MIDI clip whose track feeds a RACK opens as a STEP SEQUENCER: the rack's symbols are the
   * rows, so the panel exists exactly when the graph says the notes land on one. The graph is
   * asked for on demand (the shell holds none), `undefined` meaning "not answered yet" — the
   * roll is not flashed in the meantime, a one-request wait on the local service.
   *
   * A graph that will not BUILD is kept apart from a graph that names no rack. The two used to
   * be one `null`, so a project the compiler refuses — one bad key in one node file — read as
   * "this track feeds no rack" and quietly opened the roll instead: the panel vanished and
   * nothing on screen said why. `graphError` is that reason, and it is shown.
   */
  const midiTrack =
    target.kind !== "seq" && target.clip.type === "midi"
      ? trackPlacing(target.project, target.clip.id)
      : "";
  const [graph, setGraph] = useState<WebGraph | null | undefined>(undefined);
  const [graphError, setGraphError] = useState<string | null>(null);
  /**
   * WHICH view of these notes, and the pane's own state: a clip opens on the best view it has —
   * the sequencer when there is a rack to name the rows, the roll otherwise — and the header's
   * dropdown moves it from there. Reset per clip, so the choice is about what you are looking
   * at and not a mode the pane is stuck in.
   *
   * It replaced a one-way `forceRoll` boolean: leaving the sequencer was a button, and coming
   * back meant closing the pane and clicking the clip again.
   */
  const [mode, setMode] = useState<ClipViewMode>("sequencer");
  useEffect(() => {
    setGraphError(null);
    setMode("sequencer");
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
  // "sequencer" is the default rather than a claim: with no rack there is no grid to draw, so
  // it falls to the roll — and the dropdown does not offer what does not exist.
  const view: ClipViewMode = mode === "sequencer" && !rack ? "roll" : mode;

  /**
   * The TRACKER edits the sequence FILE, so it needs the file — and the racks the grid relabels
   * notes with. Both come off `/hints`, which already answers "which file defines this
   * sequence", and only once a tracker is actually asked for: the other two views never pay it.
   *
   * On `reloadKey` as well as on the view, so a sequence CREATED since the pane opened has a
   * path. The service memoises this on the project's revision and the editor asks for it after
   * every command anyway, so the repeat is a cache hit; `SeqGridFile` keys its read on the path,
   * which does not move, so nothing is re-read under a hand mid-edit.
   */
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
  // No title bar: each of the three leaves draws its own header already — the roll says what it
  // is and how to draw a note, the waveform names the file — and a second row above it would say
  // the same thing twice. The frame contributes the shell and one floating ✕, which is what this
  // component used to hand down to `PianoRoll` to draw for it.
  return (
    <GraphSlotPane onClose={onClose}>
      {target.kind === "seq" ? (
        <SeqRoll
          path={target.path}
          content={target.content}
          onCreateNote={onCreateNote}
          onSetVelocity={onSetVelocity}
          onSetNoteRange={onSetNoteRange}
        />
      ) : clip?.type === "midi" ? (
        graph === undefined ? (
          <div className="p-3 text-sm text-muted-foreground">
            lecture du graphe…
          </div>
        ) : rack && view === "sequencer" ? (
          <SequencerPanel
            project={project ?? target.project}
            clip={clip}
            rack={rack}
            modes={modes}
            command={command}
            // The caret is the DRAWN grid's, so the ref and `active` go to whichever of the two
            // is on screen — one at a time, or the arrows would move two carets on one press.
            caretRef={caretRef}
            active
            setStatus={setStatus}
            onSelection={onSelection}
            onSeek={onSeek}
            onSetLoop={onSetLoop}
            // …and the same right-click every other entity has, here for a pad's effects.
            onContextMenu={onContextMenu}
          />
        ) : view === "tracker" ? (
          // The tracker over the sequence FILE, headed the way the other two are — the pane's
          // own strip, since a text grid draws none of its own. It writes straight to the file
          // where the roll and the sequencer write through `sequence note …` commands; both
          // land in the same YAML (see SeqGridFile.tsx).
          <div className="flex h-full min-h-0 flex-col border-t-2 border-border">
            <div className="flex items-center gap-2 border-border border-b px-3 py-1 text-xs">
              <span className="font-semibold text-primary">▦ {seqId}</span>
              <span className="truncate text-muted-foreground">
                {seqPath ?? "…"}
              </span>
              <span className="ml-auto">{modes}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {hints && !seqPath ? (
                // The clip names no sequence file of this project — a placement whose `ref` is
                // gone, or a clip whose notes are inline. Said, rather than an empty grid.
                <div className="p-3 text-muted-foreground text-sm">
                  pas de fichier de séquence pour « {seqId} » — le tracker édite
                  un fichier, pas un événement
                </div>
              ) : seqPath ? (
                <SeqGridFile
                  path={seqPath}
                  view="tracker"
                  racks={hints?.racks ?? {}}
                  onChanged={onChanged ?? (() => {})}
                  setStatus={setStatus ?? (() => {})}
                />
              ) : (
                <div className="p-3 text-muted-foreground text-sm">
                  lecture du projet…
                </div>
              )}
            </div>
          </div>
        ) : (
          // The roll, and above it the reason the sequencer is not here when there IS one. The
          // roll still edits the notes — a graph that will not build says nothing about them —
          // so the failure is reported beside the work rather than in place of it.
          <div className="flex h-full min-h-0 flex-col">
            {graphError && (
              <div
                className="shrink-0 whitespace-pre-wrap border-amber-500/40 border-b bg-amber-500/10 px-3 py-1 text-amber-300 text-xs"
                title="le pas-à-pas a besoin du graphe pour connaître le rack en aval"
              >
                pas de séquenceur : le graphe ne se construit pas — {graphError}
              </div>
            )}
            {/* The roll's own root is `h-full`, so it gets a box to be the whole of — the
                notice takes its height off the top rather than pushing the grid out. */}
            <div className="min-h-0 min-w-0 flex-1">
              <PianoRoll
                project={project ?? target.project}
                clip={clip}
                modes={modes}
                caretRef={caretRef}
                active
                setStatus={setStatus}
                onSelection={onSelection}
                onSetLoop={onSetLoop}
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
              />
            </div>
          </div>
        )
      ) : (
        // An audio event opens the CLIP PANEL — the same one a take lands in, with its onsets, its
        // trim and its normalise. It used to open `WaveformView`, which draws the same waveform and
        // can do none of those: two ways of looking at one clip, and the one you reached by
        // clicking it was the one that could not act on it.
        clip && (
          <AudioClipPanel
            onContextMenu={onContextMenu}
            quietCommand={quietCommand}
            // So a stretch point dropped from the right-click menu — which runs through the
            // SHELL and not through this pane — is gone from the picture too.
            reloadKey={reloadKey}
            clip={clip.id}
            track={trackPlacing(project ?? target.project, clip.id)}
            // The project's own, so the twelve-bar window is twelve of THIS song's bars.
            tempo={(project ?? target.project).tempo}
            beatsPerBar={(project ?? target.project).timeSigNumerator}
            // The clicked EVENT's beat — what puts the song's ruler over the wave.
            placedAt={clip.start}
            // …and the same beat as a TIMECODE, which is how the `event …` verbs address one.
            // Spelled HERE because it needs the project's time signature, denominator included.
            eventAt={beatsToPosition(
              clip.start,
              (project ?? target.project).timeSigNumerator,
              (project ?? target.project).timeSigDenominator,
            )}
            // …and the slice of the file it plays, which the panel frames and acts on. Already the
            // intersection of the clip's own window with this placement's — the compiler does that
            // (nodeProject.ts), so there is nothing to re-derive and no second answer to keep.
            eventWindow={{ from: clip.sourceFrom, to: clip.sourceTo }}
            onSeek={onSeek}
            command={command}
            onClose={onClose}
          />
        )
      )}
    </GraphSlotPane>
  );
}
