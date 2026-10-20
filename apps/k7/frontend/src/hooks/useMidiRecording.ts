// useMidiRecording.ts — Web MIDI capture (browser-side; the engine records audio only).
// Timing comes from a beatNow() that reads the live playhead and interpolates between the
// 20 Hz frames with performance.now(), so onsets aren't quantised to the frame rate. On stop
// the take becomes a new clip on the armed lane, placed where it was played (`sequence record`).
// WHICH device is the MIDI-IN node wired to the armed lane — its card's dropdown — and no node
// means no MIDI is recorded there (packages/song/docs/midiIn.md). Access and list are asked here.

import type { EngineStore } from "@studio/engine-browser/store";
import { useCallback, useEffect, useRef, useState } from "react";
import { midiActivity } from "../midiActivity";
import {
  type CapturedNote,
  type MidiInputInfo,
  MidiRecorder,
} from "../webmidi";
import { useLatest } from "./useLatest";
import type { MidiTakeTarget } from "./useTakeRecording";

/** A MIDI pass as `event take midi` files it: song beats throughout. */
export interface MidiPass {
  start: number;
  end: number;
  notes: { t: number; d: number; k: number; v?: number }[];
  punch: { from: number; to?: number };
}

/** How early a note may come before the take's first beat and still count, landing on it — a downbeat played a hair early. */
const EARLY_BEATS = 0.25;

/** The notes that belong to a take starting at `from`: none of the count-in, an early downbeat pulled onto it. */
export function inTake(notes: CapturedNote[], from: number): CapturedNote[] {
  return notes
    .filter((n) => n.t >= from - EARLY_BEATS)
    .map((n) => (n.t < from ? { ...n, d: n.d - (from - n.t), t: from } : n))
    .filter((n) => n.d > 0);
}

/** A MIDI take rolling: its lane, the beat its material starts on, and the notes so far, read when drawn. */
export interface LiveMidiTake {
  lane: string;
  from: number;
  read: () => CapturedNote[];
  now: () => number;
}

/** The access question: unasked until something needs the keyboard, then granted or not. */
export type MidiAccess = "unasked" | "granted" | "unavailable";

export function useMidiRecording(opts: {
  store: EngineStore;
  tempo: number;
  // The transport's MIDI record button — the BROWSER's own record, beside the engine's.
  midiRecordEnabled: boolean;
  playing: boolean;
  midiArmed: string | null;
  quietCommand: (line: string) => Promise<void>;
  /** The armed lane's MIDI device, by its midi-in node's label: "" any, null no node wired to it. */
  midiDevice: string | null;
  /** Said once a take starts on a lane no midi-in node feeds, since that take records nothing. */
  onNoMidiIn?: (track: string) => void;
  /** The takes view's take, when one is armed: the pass then goes INTO that event (song docs/takes.md). */
  takeTarget?: React.RefObject<MidiTakeTarget | null>;
  /** …and where it is handed, in song beats, instead of becoming a clip of its own. */
  onTakePass?: (target: MidiTakeTarget, pass: MidiPass) => void;
  /** The armed lane PLAYED: each channel message from its keyboard, handed to the engine as it arrives. */
  onLiveMidi?: (track: string, data: number[]) => void;
  /** Told when a take ends with no notes: nothing lands, so nothing will replace the live roll. */
  onEmptyTake?: () => void;
  /** Told once a take has been written as a new clip on `lane`, so the view re-reads and opens it. */
  onLanded?: (lane: string) => void;
}): {
  midiInputs: MidiInputInfo[];
  openMidiInputs: () => Promise<boolean>;
  midiAccess: MidiAccess;
  liveTake: LiveMidiTake | null;
} {
  const {
    store,
    tempo,
    midiRecordEnabled,
    playing,
    midiArmed,
    quietCommand,
    midiDevice,
    onNoMidiIn,
    takeTarget,
    onTakePass,
    onLiveMidi,
    onLanded,
    onEmptyTake,
  } = opts;
  const onEmptyTakeRef = useLatest(onEmptyTake);
  // Where the take rolling now starts, in song beats — after its count-in, which rolls before it.
  const fromRef = useRef(0);
  const [liveTake, setLiveTake] = useState<LiveMidiTake | null>(null);
  const onLandedRef = useLatest(onLanded);
  const onLiveMidiRef = useLatest(onLiveMidi);
  const armedRef = useLatest(midiArmed);
  const onTakePassRef = useLatest(onTakePass);
  // The take this pass belongs to, and where it started — fixed at the start, as the sequence target is.
  const takeRef = useRef<{ target: MidiTakeTarget; start: number } | null>(
    null,
  );

  const midiRecRef = useRef<MidiRecorder | null>(null);
  const midiInitedRef = useRef(false);
  const midiActiveRef = useRef(false);
  // The lane armed when the take began, for a take that lands in no existing sequence.
  const midiLaneRef = useRef<string | null>(null);
  const stoppedAtRef = useRef(0);
  const frameRef = useRef<{ playhead: number; perf: number }>({
    playhead: 0,
    perf: 0,
  });
  const tempoRef = useLatest(tempo);

  // What the midi-in nodes' dropdowns offer, kept here because the ACCESS behind it lives in the recorder.
  const [midiInputs, setMidiInputs] = useState<MidiInputInfo[]>([]);
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
      const snap = store.getSnapshot();
      frameRef.current = { playhead: snap.playhead, perf: performance.now() };
      // Where play was pressed: a count-in rolls from bars BEFORE it, so the first rolling frame is not the take's start.
      if (!snap.playing) stoppedAtRef.current = snap.playhead;
    });
    return unsub;
  }, [store]);

  // One recorder for the app's life; MIDI access is lazy, so the prompt waits until a MIDI
  // track is armed or the picker is opened — whichever asks first.
  useEffect(() => {
    const rec = new MidiRecorder(beatNow, {
      onInputsChanged: refreshInputs,
      onActivity: (device) => midiActivity.ping(device),
      onLive: (data) => {
        const lane = armedRef.current;
        if (lane) onLiveMidiRef.current?.(lane, [...data]);
      },
    });
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

  // A lane losing the arm lets go of whatever it still holds: all notes off, sustain pedal up.
  useEffect(() => {
    if (!midiArmed) return;
    return () => {
      onLiveMidiRef.current?.(midiArmed, [0xb0, 64, 0]);
      onLiveMidiRef.current?.(midiArmed, [0xb0, 123, 0]);
    };
  }, [midiArmed]);

  // The armed lane's node decides which device is listened to; a change mid-take re-attaches.
  useEffect(() => {
    midiRecRef.current?.selectDevice(midiDevice);
  }, [midiDevice]);
  const onNoMidiInRef = useLatest(onNoMidiIn);

  // Start on midi-record+play with a MIDI-armed track; on stop, commit the captured notes.
  const midiRecording = midiRecordEnabled && playing && !!midiArmed;
  useEffect(() => {
    const rec = midiRecRef.current;
    if (!rec) return;
    if (midiRecording && !midiActiveRef.current) {
      midiActiveRef.current = true;
      midiLaneRef.current = midiArmed;
      const take = takeTarget?.current;
      const mine = take && take.track === midiArmed ? take : null;
      // The punch a takes-view pass named, else where play was pressed — the count-in rolls before either.
      const from =
        mine?.punch.from ?? (stoppedAtRef.current * tempoRef.current) / 60;
      fromRef.current = from;
      if (midiArmed)
        setLiveTake({
          lane: midiArmed,
          from,
          read: () => inTake(rec.liveNotes(), from),
          now: beatNow,
        });
      if (midiArmed && midiDevice === null) onNoMidiInRef.current?.(midiArmed);
      takeRef.current = mine ? { target: mine, start: from } : null;
      rec.start();
    } else if (!midiRecording && midiActiveRef.current) {
      midiActiveRef.current = false;
      setLiveTake(null);
      const notes = inTake(rec.stop(), fromRef.current);
      // A take of the takes view: the whole pass, empty or not, filed into its event.
      const take = takeRef.current;
      takeRef.current = null;
      if (take) {
        onTakePassRef.current?.(take.target, {
          start: take.start,
          end: beatNow(),
          notes: notes.map((n) => ({ t: n.t, d: n.d, k: n.k, v: n.v })),
          punch: take.target.punch,
        });
        return;
      }
      const lane = midiLaneRef.current;
      midiLaneRef.current = null;
      // Every take is a clip of its own, placed where it was played — an audio take's rule.
      if (lane && notes.length) {
        const song = notes.map((n) => ({ t: n.t, d: n.d, k: n.k, v: n.v }));
        void quietCommand(
          `sequence record ${lane} ${JSON.stringify(song)}`,
        ).then(() => onLandedRef.current?.(lane));
      } else onEmptyTakeRef.current?.();
    }
  }, [midiRecording, midiArmed, quietCommand, midiDevice, takeTarget, beatNow]);

  return {
    midiInputs,
    openMidiInputs,
    midiAccess,
    liveTake,
  };
}
