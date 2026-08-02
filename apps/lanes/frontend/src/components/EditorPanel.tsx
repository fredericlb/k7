// EditorPanel.tsx — the "Editor" bottom panel: the piano roll (MIDI) or waveform
// (audio) for the clip the user is currently on. The target comes from the active
// tab — the clip under the timeline caret, or the sequence open in the editor
// tab — lifted to the app shell so one panel serves every tab.

import { findNotesArray, parseNotes } from "@lanes/ui-editor/tracker/notes";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import { fileStem } from "../projectPaths";
import type { WebClip, WebNote, WebProject } from "../types";
import { PianoRoll } from "./PianoRoll";
import { WaveformView } from "./WaveformView";

// What to show: a concrete clip (timeline caret), or the live sequence file open in the editor, parsed here.
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
  video: false,
  viewport: [0, 0],
  fps: 30,
  videoTracks: [],
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

export function EditorPanel({
  target,
  onClose,
  onCreateNote,
}: {
  target: EditTarget | null;
  onClose: () => void;
  // Draw a note into a sequence: (seqId, key, startBeat, endBeat). Runs `sequence note new`.
  onCreateNote?: (seqId: string, key: number, t0: number, t1: number) => void;
}) {
  if (!target)
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        {m["editorPanel.nothing"]()}
      </div>
    );
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
    <WaveformView
      project={target.project}
      clip={target.clip}
      onClose={onClose}
    />
  );
}
