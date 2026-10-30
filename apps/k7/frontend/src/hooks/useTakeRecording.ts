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
import { useLatest } from "./useLatest";

/** How long after the stop the event stays armed: the engine's take is filed in that window. */
const DISARM_AFTER_MS = 4000;
/** When after the stop the view re-reads the project, so the new take shows without a reopen. */
const LANDED_AFTER_MS = [800, 2000];

/** One switch the record button flipped, and whether flipping it back is a toggle sent to the engine. */
export interface SwitchBack {
  engine: boolean;
  run: () => void;
}

/** What a stop may switch back: nothing the engine toggles while the link is down, since that would flip it under the engine. */
export function switchesBack(
  list: SwitchBack[],
  linkDown: boolean,
): SwitchBack[] {
  return linkDown ? list.filter((u) => !u.engine) : list;
}

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
  /** The transport as `store.held()` says it, so a short link drop does not end the take. */
  playing: boolean;
  /** The link's guarded transport, which refuses aloud on a dead or busy link rather than queueing. */
  transport: (verb: "play" | "stop") => void;
  seek: (seconds: number) => void;
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
  // What the button switched on, so the stop switches back exactly that and nothing a person set; `engine` marks a toggle sent to the engine.
  const undo = useRef<SwitchBack[]>([]);
  const optsRef = useLatest(opts);
  // The pending disarm after a stop, cancelled by a take started inside its window.
  const disarm = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const record = useCallback(
    (ev: TakesEvent, from: number, to: number | null) => {
      void (async () => {
        const o = optsRef.current;
        // A dead link arms nothing: the guarded transport says so, and no event is left armed for a take that never rolls.
        if (store.linkDown()) return o.transport("play");
        clearTimeout(disarm.current);
        disarm.current = undefined;
        await runCommand(armLine(ev, from, to, num, den));
        undo.current = [];
        const s = store.getSnapshot();
        if (ev.kind === "midi") {
          // The browser's arm, which `rec` is for a lane holding a sequence — the same toggle, so only when it is off.
          if (o.midiArmed !== ev.track) {
            await runCommand(`rec ${ev.track}`);
            undo.current.push({
              engine: false,
              run: () => void runCommand(`rec ${ev.track}`),
            });
          }
          if (!o.midiRecord) {
            o.setMidiRecord(true);
            undo.current.push({
              engine: false,
              run: () => optsRef.current.setMidiRecord(false),
            });
          }
          // The engine's record too, which is what rolls a count-in before the take's start.
          if (!s.recordEnabled) {
            engine()?.setRecordEnabled(true);
            undo.current.push({
              engine: true,
              run: () => engine()?.setRecordEnabled(false),
            });
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
            undo.current.push({
              engine: true,
              run: () => void runCommand(`transport arm ${ev.track}`),
            });
          }
          if (!s.recordEnabled) {
            engine()?.setRecordEnabled(true);
            undo.current.push({
              engine: true,
              run: () => engine()?.setRecordEnabled(false),
            });
          }
        }
        setActive(true);
        // From the take's start, not wherever the playhead was: the count-in rolls in the bars before it.
        const live = optsRef.current;
        if (!store.linkDown())
          live.seek((from * 60) / Math.max(1e-6, live.tempo));
        live.transport("play");
      })();
    },
    [store, engine, runCommand, num, den],
  );

  const stop = useCallback(() => optsRef.current.transport("stop"), []);

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
    // The engine's switches are TOGGLES: sent down a dead link, they would flip what a restarted engine holds.
    for (const u of switchesBack(undo.current, store.linkDown())) u.run();
    undo.current = [];
    // The take lands a moment after the stop — a MIDI pass at once, an audio file once the engine closes it.
    for (const ms of LANDED_AFTER_MS)
      setTimeout(() => optsRef.current.onLanded(), ms);
    // Not this effect's cleanup: clearing `active` re-runs it, and that must not cancel the disarm.
    disarm.current = setTimeout(() => {
      disarm.current = undefined;
      midiTarget.current = null;
      void runCommand("event take disarm");
    }, DISARM_AFTER_MS);
  }, [playing, active, runCommand, store]);
  // Leaving inside the window sends the disarm at once: an event left armed would swallow the next audio take.
  useEffect(
    () => () => {
      if (disarm.current === undefined) return;
      clearTimeout(disarm.current);
      void optsRef.current.runCommand("event take disarm");
    },
    [],
  );

  return {
    host: { projectPath, record, stop, recording: active && playing },
    active,
    midiTarget,
  };
}
