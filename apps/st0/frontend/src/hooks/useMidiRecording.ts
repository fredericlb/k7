// useMidiRecording.ts — Web MIDI capture (browser-side; the engine records audio only).
// Timing comes from a beatNow() that reads the live playhead and interpolates between the
// 20 Hz frames with performance.now(), so onsets aren't quantised to the frame rate. On
// stop the notes land in the armed track's sequence, offset to clip-local beats. The
// transport picks WHICH input — its MIDI record button carries the device picker — so the
// access, the list and the selection are asked for here and handed back to that dropdown.

import type { EngineStore } from "@studio/engine-browser/store";
import { useCallback, useEffect, useRef, useState } from "react";
import { type MidiInputInfo, MidiRecorder } from "../webmidi";

/** The access question: unasked until something needs the keyboard, then granted or not. */
export type MidiAccess = "unasked" | "granted" | "unavailable";

export function useMidiRecording(opts: {
  store: EngineStore;
  tempo: number;
  // The transport's MIDI record button — the BROWSER's own record, beside the engine's.
  midiRecordEnabled: boolean;
  playing: boolean;
  midiArmed: string | null;
  midiSeqRef: React.RefObject<Record<string, { seqId: string; start: number }>>;
  quietCommand: (line: string) => Promise<void>;
}): {
  midiInputs: MidiInputInfo[];
  midiInputId: string | null;
  selectMidiInput: (id: string | null) => void;
  openMidiInputs: () => Promise<boolean>;
  midiAccess: MidiAccess;
} {
  const {
    store,
    tempo,
    midiRecordEnabled,
    playing,
    midiArmed,
    midiSeqRef,
    quietCommand,
  } = opts;

  const midiRecRef = useRef<MidiRecorder | null>(null);
  const midiInitedRef = useRef(false);
  const midiActiveRef = useRef(false);
  const midiTargetRef = useRef<{ seqId: string; start: number } | null>(null);
  const frameRef = useRef<{ playhead: number; perf: number }>({
    playhead: 0,
    perf: 0,
  });
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;

  // The device picker's data, kept here because the ACCESS it picks for lives in the recorder.
  const [midiInputs, setMidiInputs] = useState<MidiInputInfo[]>([]);
  const [midiInputId, setMidiInputId] = useState<string | null>(null);
  const [midiAccess, setMidiAccess] = useState<MidiAccess>("unasked");

  const refreshInputs = useCallback(() => {
    setMidiInputs(midiRecRef.current?.listInputs() ?? []);
  }, []);

  const beatNow = useCallback(() => {
    const { playhead, perf } = frameRef.current;
    const secs = playhead + (performance.now() - perf) / 1000;
    return (secs * tempoRef.current) / 60;
  }, []);

  // Track the latest (playhead, wall-clock) pair so beatNow can interpolate.
  useEffect(() => {
    const unsub = store.subscribe(() => {
      frameRef.current = {
        playhead: store.getSnapshot().playhead,
        perf: performance.now(),
      };
    });
    return unsub;
  }, [store]);

  // One recorder for the app's life; MIDI access is lazy, so the prompt waits until a MIDI
  // track is armed or the picker is opened — whichever asks first.
  useEffect(() => {
    const rec = new MidiRecorder(beatNow, { onInputsChanged: refreshInputs });
    midiRecRef.current = rec;
    return () => {
      rec.dispose();
      midiRecRef.current = null;
      midiInitedRef.current = false;
    };
  }, [beatNow, refreshInputs]);

  // Request access and re-list what the browser exposes; true once granted.
  const openMidiInputs = useCallback(async (): Promise<boolean> => {
    const rec = midiRecRef.current;
    if (!rec) return false;
    const ok = await rec.init();
    setMidiAccess(ok ? "granted" : "unavailable");
    refreshInputs();
    return ok;
  }, [refreshInputs]);

  // Ask for MIDI access the first time a track is MIDI-armed.
  useEffect(() => {
    if (!midiArmed || midiInitedRef.current) return;
    midiInitedRef.current = true;
    void openMidiInputs();
  }, [midiArmed, openMidiInputs]);

  const selectMidiInput = useCallback((id: string | null) => {
    setMidiInputId(id);
    midiRecRef.current?.selectInput(id);
  }, []);

  // Start on midi-record+play with a MIDI-armed track; on stop, commit the captured notes.
  const midiRecording = midiRecordEnabled && playing && !!midiArmed;
  useEffect(() => {
    const rec = midiRecRef.current;
    if (!rec) return;
    if (midiRecording && !midiActiveRef.current) {
      midiActiveRef.current = true;
      midiTargetRef.current = midiArmed
        ? (midiSeqRef.current[midiArmed] ?? null)
        : null;
      rec.start();
    } else if (!midiRecording && midiActiveRef.current) {
      midiActiveRef.current = false;
      const notes = rec.stop();
      const target = midiTargetRef.current;
      midiTargetRef.current = null;
      if (target && notes.length) {
        const local = notes
          .map((n) => ({
            t: Math.max(0, n.t - target.start),
            d: n.d,
            k: n.k,
            v: n.v,
          }))
          .filter((n) => n.d > 0);
        if (local.length)
          void quietCommand(
            `sequence note add ${target.seqId} ${JSON.stringify(local)}`,
          );
      }
    }
  }, [midiRecording, midiArmed, quietCommand, midiSeqRef]);

  return {
    midiInputs,
    midiInputId,
    selectMidiInput,
    openMidiInputs,
    midiAccess,
  };
}
