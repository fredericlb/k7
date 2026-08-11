// ClipView.tsx — a clip's CONTENT: the waveform for audio, the piano roll for MIDI, and for a
// live sequence FILE the roll of the notes parsed out of its text. Both views draw their own
// header and close button. Two hosts mount it — the Editor bottom panel, and the graph slot
// when a clip is clicked in the timeline (see docs/shell.md).

import { findNotesArray, parseNotes } from "@studio/ui-editor/tracker/notes";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { fileStem } from "../projectPaths";
import type { WebClip, WebNote, WebProject } from "../types";
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
  onClose,
  onCreateNote,
}: {
  path: string;
  content: string;
  onClose: () => void;
  onCreateNote?: (seqId: string, key: number, t0: number, t1: number) => void;
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
    <div className="relative flex h-full min-h-0 flex-1">
      <div className="min-h-0 flex-1">
        <PianoRoll
          project={project ?? FALLBACK_PROJECT}
          clip={clip}
          onClose={onClose}
          onCreateNote={
            onCreateNote
              ? (k, t0, t1) => onCreateNote(name, k, t0, t1)
              : undefined
          }
        />
      </div>
    </div>
  );
}

export function ClipView({
  target,
  onClose,
  onCreateNote,
}: {
  target: EditTarget;
  onClose: () => void;
  // Draw a note into a sequence: (seqId, key, startBeat, endBeat). Runs `sequence note new`.
  onCreateNote?: (seqId: string, key: number, t0: number, t1: number) => void;
}) {
  if (target.kind === "seq")
    return (
      <SeqRoll
        path={target.path}
        content={target.content}
        onClose={onClose}
        onCreateNote={onCreateNote}
      />
    );
  const clip = target.clip;
  const seqId = clip.name || clip.id;
  return clip.type === "midi" ? (
    <PianoRoll
      project={target.project}
      clip={clip}
      onClose={onClose}
      onCreateNote={
        onCreateNote ? (k, t0, t1) => onCreateNote(seqId, k, t0, t1) : undefined
      }
    />
  ) : (
    <WaveformView project={target.project} clip={clip} onClose={onClose} />
  );
}
