// usePairing.ts — the machine's side of LAN pairing, as one hook over a live EngineClient: the
// requests waiting for an answer and the devices already paired, both pushed by the engine.
// The engine answers these to its own machine only; `localOnly` is its refusal. See ../../docs/pairing.md.

import type {
  EngineClient,
  PairedDevice,
  PairRequest,
} from "@studio/engine-browser";
import { useEffect, useState } from "react";

export interface Pairing {
  requests: PairRequest[];
  devices: PairedDevice[];
  /** The engine refused: this page does not reach it from its own machine. */
  localOnly: boolean;
}

export function usePairing(
  engine: EngineClient | null | undefined,
  connected: boolean,
): Pairing {
  const [requests, setRequests] = useState<PairRequest[]>([]);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [localOnly, setLocalOnly] = useState(false);

  useEffect(() => {
    if (!engine || !connected) return;
    const offReq = engine.onPairRequests(setRequests);
    const offDev = engine.onPairedDevices(setDevices);
    const offWarn = engine.onWarning((w) => {
      // An unpaired LAN device is refused before that question is even asked; the answer to give is the same.
      if (w.code === "local-only" || w.code === "unpaired") setLocalOnly(true);
    });
    // Asked on every (re)connect: the pushes only say what CHANGED after this socket opened.
    engine.listPairRequests();
    engine.listPairedDevices();
    return () => {
      offReq();
      offDev();
      offWarn();
      setRequests([]);
    };
  }, [engine, connected]);

  return { requests, devices, localOnly };
}
