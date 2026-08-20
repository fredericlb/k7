// useProjectDoc.ts — the compiled doc's slice of shell state, refetched on reloadKey.
// The doc drives the strudel poll gate, the track order
// the engine meters index by, the mixer state for the track-node controls, and the
// recording overlay's fields. Extracted from App.tsx; behaviour unchanged.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { mixerModules } from "../mixerStrips";
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
  /**
   * The mixer NODE the level and pan live on — `mixer.module`, e.g. "mixer:vo.jo".
   *
   * Carried because a knob has to name it: those two are `node param <this> Volume|Pan` now,
   * and a track states no level of its own to address instead. Empty when the track has no
   * strip, which is not "at unity" — it is a track with nowhere to put a level, and the knob
   * has to refuse rather than invent a module ref.
   */
  mixer: string;
}

export interface ProjectDocState {
  trackOrder: string[];
  metronomeOn: boolean;
  recInfo: RecInfo;
  docTracks: DocTrack[];
  /**
   * The compiled document itself, or null before the first one lands.
   *
   * Everything above is a PROJECTION of it, cut so a consumer re-renders on its own slice. This is
   * for the one thing no projection serves: reading a lane's NOTES, which the rack pads derive
   * their lit state from (`rackLit.ts`). Kept rather than re-fetched — the doc is already here.
   */
  doc: WebProject | null;
  /** The modules the Mixer view lines up, in track order — `mixerStrips.ts` decides which. */
  mixerStrips: string[];
  hasStrudel: boolean;
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
  const [hasStrudel, setHasStrudel] = useState(false);
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
            // The graph node's fader is in dB and its pan 0..1, which is what its widgets declare — read off
            // the track's mixer module, since a track states neither itself. No mixer means no strip: unity is
            // the honest thing to draw for a lane that has nowhere to put a level.
            volume: t.mixer?.volume ?? 0,
            pan: ((t.mixer?.pan ?? 0) + 1) / 2,
            mixer: t.mixer?.module ?? "",
            mute: t.mute,
            solo: t.solo,
          })),
        );
        setHasStrudel(!!p.strudel);
      })
      .catch(() => {
        // No doc: reset what is derived from it.
        if (!alive) return;
        setHasStrudel(false);
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
    recInfo,
    docTracks,
    doc,
    mixerStrips,
    hasStrudel,
    midiSeqRef,
  };
}
