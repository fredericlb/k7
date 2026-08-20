// useInputDevices — the interface's inputs as the ENGINE groups them, for whatever has to offer a
// choice of one, plus the one act that changes that grouping. Asked when it is wanted rather than
// polled: a rig's channel grouping only changes when something here changes it.

import type { EngineClient, EngineInputDevice } from "@studio/engine-browser";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

const NONE: EngineInputDevice[] = [];

/**
 * The engine's input devices, empty until it answers (and while `want` is false), and `regroup` to
 * pair two of them into a stereo device or split them apart.
 *
 * `ioLevels` is the only message that carries the devices, and it is also what METERS an input —
 * which enables it engine-side, per IoPanel. So this asks with an empty set list: the reply's device
 * grouping is the whole point, the levels in it are ignored, and nothing gets switched on for a
 * question about what exists. The engine fills `devices` from the sound card either way — it does
 * not derive it from what was asked to be metered.
 *
 * The empty ask does clear the tuner's watch list engine-side, so an IO panel left open loses one
 * frame of pitch. It repolls ten times a second, so that is the whole cost.
 *
 * `regroup` re-asks straight after: the engine sends nothing back for it (the layout has exactly one
 * route to a client, and a second would be a second thing to keep in step), and it forces the
 * device-list rebuild through before it answers anything else, so the next reply is the new grouping.
 */
export function useInputDevices(
  engine: EngineClient | null,
  want: boolean,
): {
  devices: EngineInputDevice[];
  regroup: (channel: number, stereo: boolean) => void;
} {
  const [devices, setDevices] = useState<EngineInputDevice[]>(NONE);
  const [asked, setAsked] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `asked` is not read in here — it is
  // the ask ITSELF, bumped by regroup so the question is put again once the interface has changed.
  useEffect(() => {
    if (!engine || !want) return;
    const off = engine.onIoLevels((l) => {
      if (l.devices) setDevices(l.devices);
    });
    engine.ioLevels([]);
    return off;
  }, [engine, want, asked]);

  const regroup = useCallback(
    (channel: number, stereo: boolean) => {
      if (!engine) return;
      engine.setInputStereo(channel, stereo);
      setAsked((n) => n + 1); // …and read back what the interface became
      // The engine forgets this across a restart as surely as it forgets which interface to open,
      // so the rig's file is what makes it stick — replayed by engineLink on the next connect.
      // Fire and forget: the grouping has already happened, and a failed write costs its memory,
      // not the act.
      void api.setInputPair(channel, stereo).catch(() => {});
    },
    [engine],
  );

  return { devices, regroup };
}
