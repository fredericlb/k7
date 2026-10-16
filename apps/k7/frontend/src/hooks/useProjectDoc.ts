// useProjectDoc.ts — the compiled doc's slice of shell state, refetched on reloadKey.
// The doc drives the strudel poll gate, the track order
// the engine meters index by, the mixer state for the track-node controls, and the
// recording overlay's fields. Apart from App.tsx, which only wires it.

import { DEFAULT_METRONOME_LEVEL } from "@studio/engine-protocol/build";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { mixerModules } from "../mixerStrips";
import { isAnswer } from "../readFailure";
import type { WebProject } from "../types";

export interface RecInfo {
  tempo: number;
  beatsPerBar: number;
  /** The signature's lower number — carried alongside `beatsPerBar` so the footer can print `4/4`. */
  beatUnit: number;
  countIn: number;
  names: Record<string, string>;
}

export interface DocTrack {
  id: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /** Heard 10 dB up from the mixer (packages/song/docs/highlight.md). */
  highlight: boolean;
  /** The mixer NODE the level and pan live on — empty when the track has no strip, which is not 'at unity' but nowhere to put a level. */
  mixer: string;
}

export interface ProjectDocState {
  trackOrder: string[];
  metronomeOn: boolean;
  /** How loud the click is, 0.2 … 1 — the footer button's right-click slider sits on this. */
  metronomeLevel: number;
  recInfo: RecInfo;
  docTracks: DocTrack[];
  /** The compiled document itself, or null before the first lands — for the one thing no projection serves: a lane's NOTES (rackLit.ts). */
  doc: WebProject | null;
  /** The modules the Mixer view lines up, in track order — `mixerStrips.ts` decides which. */
  mixerStrips: string[];
  /** The MIDI sequence each track carries ({seqId, start-in-beats}), by track id. */
  midiSeqRef: React.RefObject<Record<string, { seqId: string; start: number }>>;
}

export function useProjectDoc(
  reloadKey: number,
  opts: {
    /** Called on every doc load with the fresh seq map — disarm a stale MIDI arm. */
    onMidiSeqs: (
      seqs: Record<string, { seqId: string; start: number }>,
    ) => void;
  },
): ProjectDocState {
  const [trackOrder, setTrackOrder] = useState<string[]>([]);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [metronomeLevel, setMetronomeLevel] = useState(DEFAULT_METRONOME_LEVEL);
  const [recInfo, setRecInfo] = useState<RecInfo>({
    tempo: 120,
    beatsPerBar: 4,
    beatUnit: 4,
    countIn: 0,
    names: {},
  });
  const [docTracks, setDocTracks] = useState<DocTrack[]>([]);
  const [doc, setDoc] = useState<WebProject | null>(null);
  // Off the SAME doc, so the row and the faders can never be one reload apart.
  const [mixerStrips, setMixerStrips] = useState<string[]>([]);
  const midiSeqRef = useRef<Record<string, { seqId: string; start: number }>>(
    {},
  );
  // The callbacks ride a ref so a re-created callback doesn't refetch the doc.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let alive = true;
    api
      .projectDoc()
      .then((p) => {
        if (!alive) return;
        setDoc(p);
        setTrackOrder(p.tracks.map((t) => t.id));
        setMetronomeOn(p.metronome);
        setMetronomeLevel(p.metronomeLevel);
        setRecInfo({
          tempo: p.tempo,
          beatsPerBar: p.timeSigNumerator || 4,
          beatUnit: p.timeSigDenominator || 4,
          countIn: p.countIn,
          names: Object.fromEntries(p.tracks.map((t) => [t.id, t.name])),
        });
        // An instrument track's sequence is its first midi clip; a track with none can't be MIDI-armed.
        const seqByTrack: Record<string, { seqId: string; start: number }> = {};
        for (const t of p.tracks) {
          const seq = t.clips.find((c) => c.type === "midi");
          if (seq) seqByTrack[t.id] = { seqId: seq.id, start: seq.start };
        }
        midiSeqRef.current = seqByTrack;
        optsRef.current.onMidiSeqs(seqByTrack);
        setMixerStrips(mixerModules(p));
        setDocTracks(
          p.tracks.map((t) => ({
            id: t.id,
            // The graph node's fader is in dB and its pan 0..1, read off the track's mixer module; no mixer means no strip, so unity is honest.
            volume: t.mixer?.volume ?? 0,
            pan: ((t.mixer?.pan ?? 0) + 1) / 2,
            mixer: t.mixer?.module ?? "",
            mute: t.mute,
            solo: t.solo,
            highlight: !!t.highlight,
          })),
        );
      })
      .catch((e) => {
        // No doc — a project that does not compile — resets what is derived from it; a blip keeps the strips.
        if (!alive || !isAnswer(e)) return;
        setDocTracks([]);
        setMixerStrips([]);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return {
    trackOrder,
    metronomeOn,
    metronomeLevel,
    recInfo,
    docTracks,
    doc,
    mixerStrips,
    midiSeqRef,
  };
}
