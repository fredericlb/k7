// useTrackControls.ts — the per-track mixer state the timeline and the graph node
// controls both read (doc mute/solo/volume/pan + optimistic overrides + the engine's
// live armed set), and the toggle handler the m/s/r keys share with the buttons.
// Extracted from App.tsx; behaviour unchanged.

import type { TrackControlValues } from "@studio/ui-chains/graph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocTrack } from "./useProjectDoc";

export function useTrackControls(opts: {
  docTracks: DocTrack[];
  armed: string[];
  midiArmed: string | null;
  setMidiArmed: React.Dispatch<React.SetStateAction<string | null>>;
  midiSeqRef: React.RefObject<Record<string, { seqId: string; start: number }>>;
  quietCommand: (line: string) => Promise<void>;
  bumpReload: () => void;
  /** Mute and solo are the VIEWER's, not the document's — a shared snapshot has nothing to write to, so they mean which stem sounds. */
  local?: boolean;
}): {
  trackControls: Record<string, TrackControlValues>;
  onTrackToggle: (id: string, control: "mute" | "solo" | "arm") => void;
  onTrackSet: (id: string, control: "volume" | "pan", value: number) => void;
} {
  const {
    docTracks,
    armed,
    midiArmed,
    setMidiArmed,
    midiSeqRef,
    quietCommand,
    bumpReload,
    local = false,
  } = opts;

  // Optimistic mute/solo by track id: the tap flips at once, and the override drops once the refetched doc agrees.
  const [optMS, setOptMS] = useState<
    Record<string, { mute?: 0 | 1; solo?: 0 | 1 }>
  >({});

  const trackControls = useMemo<Record<string, TrackControlValues>>(() => {
    const out: Record<string, TrackControlValues> = {};
    for (const t of docTracks) {
      const o = optMS[t.id];
      out[t.id] = {
        volume: t.volume,
        pan: t.pan,
        mute: o?.mute ?? (t.mute ? 1 : 0),
        solo: o?.solo ?? (t.solo ? 1 : 0),
        // Armed == the engine's audio arm OR being the MIDI capture target, so both kinds of recording read the same.
        arm: armed.includes(t.id) || midiArmed === t.id ? 1 : 0,
      };
    }
    return out;
  }, [docTracks, armed, optMS, midiArmed]);

  // The doc's own mute/solo, read to know what to flip TO without re-creating the callback on every refetch.
  const docMSRef = useRef<Record<string, { mute: 0 | 1; solo: 0 | 1 }>>({});
  useEffect(() => {
    const m: Record<string, { mute: 0 | 1; solo: 0 | 1 }> = {};
    for (const t of docTracks)
      m[t.id] = { mute: t.mute ? 1 : 0, solo: t.solo ? 1 : 0 };
    docMSRef.current = m;
    // A fresh doc IS the source of truth — except locally, where it never catches up, so clearing would silently un-mute every lane.
    if (!local) setOptMS({});
  }, [docTracks, local]);

  // Toggle mute/solo/arm: flip optimistically, run, and only THEN bump the reload — refetching first reads stale state.
  const onTrackToggle = useCallback(
    (id: string, control: "mute" | "solo" | "arm") => {
      if (control === "arm") {
        // An instrument track arms for MIDI capture in the browser; an audio track arms in the ENGINE, hence `transport arm`.
        if (midiSeqRef.current[id]) {
          setMidiArmed((cur) => (cur === id ? null : id));
          return;
        }
        void quietCommand(`transport arm ${id}`);
        return;
      }
      setOptMS((prev) => {
        const cur = prev[id]?.[control] ?? docMSRef.current[id]?.[control] ?? 0;
        return { ...prev, [id]: { ...prev[id], [control]: cur ? 0 : 1 } };
      });
      // Locally the 'optimistic' override IS the value: no command to run, and nothing to reconcile against.
      if (local) return;
      void quietCommand(`track ${control} ${id}`)
        .then(bumpReload)
        .catch(bumpReload); // reconcile even if it failed
    },
    [quietCommand, bumpReload, midiSeqRef, setMidiArmed, local],
  );

  // Commit a volume/pan knob by addressing the MIXER NODE, in the units the widget declares — `volume` in dB, needing no conversion at all.
  const mixerOf = useCallback(
    (id: string) => docTracks.find((t) => t.id === id)?.mixer ?? "",
    [docTracks],
  );
  const onTrackSet = useCallback(
    (id: string, control: "volume" | "pan", value: number) => {
      const node = mixerOf(id);
      if (!node) return;
      // Quoted: a node ref carries a `:` and may carry spaces, and `node param` splits on them.
      const param = control === "pan" ? "Pan" : "Volume";
      const v =
        control === "pan"
          ? (value * 2 - 1).toFixed(2)
          : Math.max(-60, value).toFixed(1);
      void quietCommand(`node param "${node}" ${param} ${v}`);
    },
    [quietCommand, mixerOf],
  );

  // No reload bump, deliberately: a knob is released dozens of times while mixing, and the next edit reconciles it.
  return { trackControls, onTrackToggle, onTrackSet };
}
