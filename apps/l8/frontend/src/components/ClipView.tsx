// ClipView.tsx — a clip's CONTENT: the AudioClipPanel for audio, the piano roll for MIDI, and for
// a live sequence FILE the roll of the notes parsed out of its text. Each draws its own header and
// close button. Two hosts mount it — the Editor bottom panel, and the graph slot when a clip is
// clicked in the timeline (see docs/shell.md).
//
// Audio used to open `WaveformView`, which draws the same picture and can act on none of it. There
// is one audio clip panel now, and clicking a clip reaches it.

import type { WebGraph } from "@studio/graph-model";
import { seqWindowFromText, windowSpan } from "@studio/song/seqWindow";
import { findNotesArray, parseNotes } from "@studio/ui-editor/tracker/notes";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { fileStem } from "../projectPaths";
import { rackFor } from "../rackFor";
import { trackPlacing } from "../takeReview";
import type { WebClip, WebNote, WebProject } from "../types";
import { AudioClipPanel } from "./AudioClipPanel";
import { GraphSlotPane } from "./GraphSlotPane";
import { PianoRoll } from "./PianoRoll";
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
  strudel: false,
  // Only the tempo and the signature are read off this; the shape of the project says nothing
  // about how one clip's roll is drawn. `arrangement` because it is the default everywhere else.
  mode: "arrangement",
  tracks: [],
  groups: [],
  metronome: false,
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
  onCreateNote,
  onSetVelocity,
  onSetNoteRange,
}: {
  target: EditTarget;
  onClose: () => void;
  /** Bumped by the shell after every command's reload — what keeps the open clip FRESH below. */
  reloadKey?: number;
  /** Seek the transport, in SONG seconds — what a click on a clip editor's arrangement ruler
   *  does. Threaded to both editors; a sequence FILE has no placement and draws no such ruler. */
  onSeek?: (seconds: number) => void;
  /** Runs a command line through the shell, which journals it — what the audio clip panel's
   *  onsets, trim and normalise go through. A note edit takes the callbacks below instead, because
   *  those existed first and the roll builds its own lines. */
  command: (line: string) => void | Promise<void>;
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
   * `forceRoll` is the way out for what a grid cannot say (velocities, off-grid timing, keys
   * the rack does not name); reopening the clip returns to the sequencer.
   */
  const midiTrack =
    target.kind !== "seq" && target.clip.type === "midi"
      ? trackPlacing(target.project, target.clip.id)
      : "";
  const [graph, setGraph] = useState<WebGraph | null | undefined>(undefined);
  const [forceRoll, setForceRoll] = useState(false);
  useEffect(() => {
    setForceRoll(false);
    if (!midiTrack) return void setGraph(null);
    let cancelled = false;
    setGraph(undefined);
    void api
      .graph()
      .then((g) => !cancelled && setGraph(g))
      .catch(() => !cancelled && setGraph(null));
    return () => {
      cancelled = true;
    };
  }, [midiTrack, clip?.id]);
  const rack = midiTrack ? rackFor(graph ?? null, midiTrack) : null;
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
        ) : rack && !forceRoll ? (
          <SequencerPanel
            project={project ?? target.project}
            clip={clip}
            rack={rack}
            onOpenRoll={() => setForceRoll(true)}
            command={command}
          />
        ) : (
          <PianoRoll
            project={project ?? target.project}
            clip={clip}
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
        )
      ) : (
        // An audio event opens the CLIP PANEL — the same one a take lands in, with its onsets, its
        // trim and its normalise. It used to open `WaveformView`, which draws the same waveform and
        // can do none of those: two ways of looking at one clip, and the one you reached by
        // clicking it was the one that could not act on it.
        clip && (
          <AudioClipPanel
            clip={clip.id}
            track={trackPlacing(project ?? target.project, clip.id)}
            // The project's own, so the twelve-bar window is twelve of THIS song's bars.
            tempo={(project ?? target.project).tempo}
            beatsPerBar={(project ?? target.project).timeSigNumerator}
            // The clicked EVENT's beat — what puts the song's ruler over the wave.
            placedAt={clip.start}
            onSeek={onSeek}
            command={command}
            onClose={onClose}
          />
        )
      )}
    </GraphSlotPane>
  );
}
