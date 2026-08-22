// useInputDevices — the interface's inputs as the ENGINE groups them, for whatever has to offer a
// choice of one, plus the one act that changes that grouping. Asked when it is wanted rather than
// polled: a rig's channel grouping only changes when something here changes it.

import type { EngineClient, EngineInputDevice } from "@studio/engine-browser";
import { useCallback, useEffect, useState } from "react";

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
 *
 * The act itself is a COMMAND — `system channel type <channel> <mono|stereo>` — and not this hook's
 * two calls any more. It was the engine message on the shell's own socket plus a write to the rig's
 * preferences, which is one act with two doors and no name: nothing in the palette could pair two
 * inputs, and nothing in the log said anybody had. The verb does both on the service's side; what
 * is left here is asking the engine what it became.
 */
export function useInputDevices(
  engine: EngineClient | null,
  want: boolean,
  /** How to run a command line. The re-ask waits on it, so the devices are read back after the
   *  grouping has actually changed rather than one round trip before it. */
  command: (line: string) => Promise<void>,
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
      // …and read back what the interface became, once the verb has been through. Bumped even on
      // a refusal: the question is "what is the grouping now", and the honest answer after a
      // command that did not land is the one the engine already had.
      void command(
        `system channel type ${channel} ${stereo ? "stereo" : "mono"}`,
      ).finally(() => setAsked((n) => n + 1));
    },
    [command],
  );

  return { devices, regroup };
}
