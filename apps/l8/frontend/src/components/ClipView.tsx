// ClipView.tsx — a clip's CONTENT: the waveform for audio, the piano roll for MIDI, and for a
// live sequence FILE the roll of the notes parsed out of its text. Both views draw their own
// header and close button. Two hosts mount it — the Editor bottom panel, and the graph slot
// when a clip is clicked in the timeline (see docs/shell.md).

import { findNotesArray, parseNotes } from "@studio/ui-editor/tracker/notes";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { fileStem } from "../projectPaths";
import type { WebClip, WebNote, WebProject } from "../types";
import { GraphSlotPane } from "./GraphSlotPane";
import { PianoRoll } from "./PianoRoll";
import { WaveformView } from "./WaveformView";

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
  const clip: WebClip = {
    id: path,
    type: "midi",
    name,
    start: 0,
    length: 0,
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
  onCreateNote,
  onSetVelocity,
  onSetNoteRange,
}: {
  target: EditTarget;
  onClose: () => void;
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
  const clip = target.kind === "seq" ? null : target.clip;
  const seqId = clip ? clip.name || clip.id : "";
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
        <PianoRoll
          project={target.project}
          clip={clip}
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
      ) : (
        clip && <WaveformView project={target.project} clip={clip} />
      )}
    </GraphSlotPane>
  );
}
