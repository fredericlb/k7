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
  /**
   * Mute and solo are the VIEWER's, not the document's — a shared snapshot.
   *
   * The two are normally writes: `m` rewrites the lane's bypass in `graph.yaml` and `s` rewrites
   * `project.yaml`'s `soloed:` list, because a mute is a decision about the song and not a
   * session flag. On a snapshot there is nothing to write to, and `fsend` would refuse — so
   * these become what a listener means by them instead: which of the rendered stems is sounding.
   *
   * `arm` is untouched and stays a command: nothing arms without an engine, and the refusal
   * saying so is better than a button that pretends.
   */
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
    // A fresh doc IS the source of truth — drop optimistic overrides it now reflects. Except
    // locally, where the doc is NOT the source of truth for these two and never catches up:
    // clearing would silently un-mute every lane the moment anything re-read the project.
    if (!local) setOptMS({});
  }, [docTracks, local]);

  // Toggle mute/solo/arm — the same commands m/s/r run. Flip optimistically, run, and only THEN bump the reload:
  // refetching before the command settles reads stale state and leaves the button lagging.
  const onTrackToggle = useCallback(
    (id: string, control: "mute" | "solo" | "arm") => {
      if (control === "arm") {
        // An instrument track arms for MIDI capture in the browser; an audio track arms in the
        // ENGINE, which is why the verb is `transport arm`: it names a lane but nothing about it
        // is written down, and a reload does not restore it.
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
      // Locally, the "optimistic" override IS the value: there is nothing to be optimistic
      // about, no command to run and nothing to reconcile against.
      if (local) return;
      void quietCommand(`track ${control} ${id}`)
        .then(bumpReload)
        .catch(bumpReload); // reconcile even if it failed
    },
    [quietCommand, bumpReload, midiSeqRef, setMidiArmed, local],
  );

  // Commit a volume/pan knob from a graph track node — the counterpart of onTrackToggle,
  // and the thing whose absence made those two knobs inert: the graph called
  // `onTrackSet?.()` on release, App never passed one, and the optional call swallowed it.
  //
  // UNITS. `trackControls` reports what the knob reads and hands back: `volume` in dB, as
  // its widget declares (min -60, max 6), and `pan` as 0..1. The MIXER MODULE behind them
  // stores the level in dB too, so the level needs no conversion at all — only the pan,
  // which the command takes as -1..+1.
  //
  // It used to convert a linear gain to dB here, because a track carried a linear volume.
  // Left in place over a value that is ALREADY dB, that sum takes the log of a negative
  // number: every fader below unity would have written silence.
  // …and it addresses the MIXER NODE by name. `track gain` / `track pan` are gone: they were two
  // verbs reaching one module's params by the wrong noun, and every other param on that same
  // module already answered to `node param`. A track with no strip has no node to name, so the
  // knob does nothing rather than inventing one — the same refusal the old command made in
  // words, and the graph draws no fader for such a lane anyway.
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

  // No reload bump, deliberately: a knob is released dozens of times while mixing, and
  // refetching the whole project on each would fight the next drag. The graph already
  // shows the value optimistically (see `override` in DomChains), and the next reload
  // — any other edit — reconciles it.
  return { trackControls, onTrackToggle, onTrackSet };
}
