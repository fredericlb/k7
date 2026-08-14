// useInputDevices — the interface's inputs as the ENGINE groups them, for whatever has to offer a
// choice of one. Asked once when it is wanted rather than polled: a rig's channel grouping is a
// property of the sound card, and it does not change while somebody edits a module.

import type { EngineClient, EngineInputDevice } from "@studio/engine-browser";
import { useEffect, useState } from "react";

const NONE: EngineInputDevice[] = [];

/**
 * The engine's input devices, empty until it answers (and while `want` is false).
 *
 * `ioLevels` is the only message that carries them, and it is also what METERS an input — which
 * enables it engine-side, per IoPanel. So this asks with an empty set list: the reply's device
 * grouping is the whole point, the levels in it are ignored, and nothing gets switched on for a
 * question about what exists. The engine fills `devices` from the sound card either way — it does
 * not derive it from what was asked to be metered.
 *
 * The empty ask does clear the tuner's watch list engine-side, so an IO panel left open loses one
 * frame of pitch. It repolls ten times a second and this asks ONCE, so that is the whole cost.
 */
export function useInputDevices(
  engine: EngineClient | null,
  want: boolean,
): EngineInputDevice[] {
  const [devices, setDevices] = useState<EngineInputDevice[]>(NONE);

  useEffect(() => {
    if (!engine || !want) return;
    const off = engine.onIoLevels((l) => {
      if (l.devices) setDevices(l.devices);
    });
    engine.ioLevels([]);
    return off;
  }, [engine, want]);

  return devices;
}
