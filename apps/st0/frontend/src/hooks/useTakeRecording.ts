// useTakeRecording.ts — the takes view's record button: arm the EVENT (the file service then files
// the take into it and sends the engine the lane with its punch cut out), arm the lane and switch
// record on where they were not, roll from the take's start — the engine counts in BEFORE it; on
// stop, put back what it switched and disarm the event. The
// one thing a reader would get wrong: the disarm WAITS — an audio take reaches the file service
// after the stop, and an event disarmed first would see it land on the lane. See song docs/takes.md.

import type { EngineClient } from "@studio/engine-browser";
import type { EngineStore } from "@studio/engine-browser/store";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TakesHost } from "../components/TakesView";
import { armLine, type TakesEvent } from "../takes";

/** How long after the stop the event stays armed: the engine's take is filed in that window. */
const DISARM_AFTER_MS = 4000;
/** When after the stop the view re-reads the project, so the new take shows without a reopen. */
const LANDED_AFTER_MS = [800, 2000];

/** A MIDI take in progress, read by useMidiRecording when the pass ends. */
export interface MidiTakeTarget {
  track: string;
  at: string;
  punch: { from: number; to?: number };
}

export function useTakeRecording(opts: {
  store: EngineStore;
  engine: () => EngineClient | null;
  runCommand: (line: string) => Promise<void>;
  playing: boolean;
  midiArmed: string | null;
  midiRecord: boolean;
  setMidiRecord: (on: boolean) => void;
  num: number;
  den: number;
  /** Beats to seconds, for the seek to the take's start. */
  tempo: number;
  projectPath: string;
  /** Re-read the project: the take is filed after the stop, and the view must show it without a reopen. */
  onLanded: () => void;
}): {
  host: TakesHost;
  /** A take is on: what keeps the shell's own record panel from taking the view's place. */
  active: boolean;
  midiTarget: React.RefObject<MidiTakeTarget | null>;
} {
  const { store, engine, runCommand, playing, num, den, projectPath } = opts;
  const [active, setActive] = useState(false);
  const midiTarget = useRef<MidiTakeTarget | null>(null);
  // What the button switched on, so the stop switches back exactly that and nothing a person set.
  const undo = useRef<(() => void)[]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // The pending disarm after a stop, cancelled by a take started inside its window.
  const disarm = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const record = useCallback(
    (ev: TakesEvent, from: number, to: number | null) => {
      void (async () => {
        const o = optsRef.current;
        clearTimeout(disarm.current);
        await runCommand(armLine(ev, from, to, num, den));
        undo.current = [];
        const s = store.getSnapshot();
        if (ev.kind === "midi") {
          // The browser's arm, which `rec` is for a lane holding a sequence — the same toggle, so only when it is off.
          if (o.midiArmed !== ev.track) {
            await runCommand(`rec ${ev.track}`);
            undo.current.push(() => void runCommand(`rec ${ev.track}`));
          }
          if (!o.midiRecord) {
            o.setMidiRecord(true);
            undo.current.push(() => optsRef.current.setMidiRecord(false));
          }
          // The engine's record too, which is what rolls a count-in before the take's start.
          if (!s.recordEnabled) {
            engine()?.setRecordEnabled(true);
            undo.current.push(() => engine()?.setRecordEnabled(false));
          }
          midiTarget.current = {
            track: ev.track,
            at: ev.at,
            punch: to === null ? { from } : { from, to },
          };
        } else {
          // The ENGINE's arm, as the lane's own button arms an audio lane — and a toggle, so only when it is off.
          if (!s.armed.includes(ev.track)) {
            await runCommand(`transport arm ${ev.track}`);
            undo.current.push(
              () => void runCommand(`transport arm ${ev.track}`),
            );
          }
          if (!s.recordEnabled) {
            engine()?.setRecordEnabled(true);
            undo.current.push(() => engine()?.setRecordEnabled(false));
          }
        }
        setActive(true);
        // From the take's start, not wherever the playhead was: the count-in rolls in the bars before it.
        engine()?.seek((from * 60) / Math.max(1e-6, optsRef.current.tempo));
        engine()?.transport("play");
      })();
    },
    [store, engine, runCommand, num, den],
  );

  const stop = useCallback(() => engine()?.transport("stop"), [engine]);

  // The roll that ended IS the take: switch back what the button switched, then let the event go.
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (playing) {
      wasPlaying.current = true;
      return;
    }
    if (!active || !wasPlaying.current) return;
    wasPlaying.current = false;
    setActive(false);
    for (const u of undo.current) u();
    undo.current = [];
    // The take lands a moment after the stop — a MIDI pass at once, an audio file once the engine closes it.
    for (const ms of LANDED_AFTER_MS)
      setTimeout(() => optsRef.current.onLanded(), ms);
    // Not this effect's cleanup: clearing `active` re-runs it, and that must not cancel the disarm.
    disarm.current = setTimeout(() => {
      midiTarget.current = null;
      void runCommand("event take disarm");
    }, DISARM_AFTER_MS);
  }, [playing, active, runCommand]);
  useEffect(() => () => clearTimeout(disarm.current), []);

  return {
    host: { projectPath, record, stop, recording: active && playing },
    active,
    midiTarget,
  };
}
