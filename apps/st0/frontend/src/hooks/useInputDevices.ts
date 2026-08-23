// useInputDevices — the interface's inputs as the ENGINE groups them, for whatever has to offer a
// choice of one, plus the one act that changes that grouping. Asked when it is wanted rather than
// polled: a rig's channel grouping only changes when something here changes it.

import type { EngineClient, EngineInputDevice } from "@studio/engine-browser";
import { useCallback, useEffect, useState } from "react";

const NONE: EngineInputDevice[] = [];

/** The engine's input devices, and `regroup` — asked with an EMPTY set list, since `ioLevels` also meters what it is given (docs/shell.md). */
export function useInputDevices(
  engine: EngineClient | null,
  want: boolean,
  /** How to run a command line — the re-ask waits on it, so the devices are read back after the grouping has actually changed. */
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
      // …and read back what the interface became, bumped even on a refusal: the question is what the grouping is NOW.
      void command(
        `system channel type ${channel} ${stereo ? "stereo" : "mono"}`,
      ).finally(() => setAsked((n) => n + 1));
    },
    [command],
  );

  return { devices, regroup };
}
