// useMidiRecording.ts — Web MIDI capture (browser-side; the engine records audio only).
// Timing comes from a beatNow() that reads the live playhead and interpolates between the
// 20 Hz frames with performance.now(), so onsets aren't quantised to the frame rate. On
// stop the notes land in the armed track's sequence, offset to clip-local beats.

import { useCallback, useEffect, useRef } from "react";
import type { EngineStore } from "../engineStore";
import { MidiRecorder } from "../webmidi";

export function useMidiRecording(opts: {
  store: EngineStore;
  tempo: number;
  recordEnabled: boolean;
  playing: boolean;
  midiArmed: string | null;
  midiSeqRef: React.RefObject<Record<string, { seqId: string; start: number }>>;
  quietCommand: (line: string) => Promise<void>;
}): void {
  const {
    store,
    tempo,
    recordEnabled,
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

  // One recorder for the app's life; MIDI access is lazy, so the prompt waits until a MIDI track is armed.
  useEffect(() => {
    const rec = new MidiRecorder(beatNow);
    midiRecRef.current = rec;
    return () => {
      rec.dispose();
      midiRecRef.current = null;
      midiInitedRef.current = false;
    };
  }, [beatNow]);

  // Request MIDI access the first time a track is MIDI-armed.
  useEffect(() => {
    if (!midiArmed || midiInitedRef.current) return;
    midiInitedRef.current = true;
    void midiRecRef.current?.init();
  }, [midiArmed]);

  // Start on record+play with a MIDI-armed track; on stop, commit the captured notes.
  const midiRecording = recordEnabled && playing && !!midiArmed;
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
}
