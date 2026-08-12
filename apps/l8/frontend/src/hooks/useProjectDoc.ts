// useProjectDoc.ts — the compiled doc's slice of shell state, refetched on reloadKey.
// The doc drives the strudel poll gate, the track order
// the engine meters index by, the mixer state for the track-node controls, and the
// recording overlay's fields. Extracted from App.tsx; behaviour unchanged.

import type { ProjectMode } from "@studio/engine-protocol/project";
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
  /**
   * Which of l8's two shapes the open project has — `live` means the shell draws the graph alone.
   *
   * `arrangement` until the first doc lands, which is the honest default: it is what a project
   * that says nothing is, and it is what all but one of them are. The cost is that a LIVE project
   * shows an empty timeline for the one frame between mount and the doc's arrival. Paid here
   * rather than by holding the whole shell back on a fetch, and see docs/projectMode.md for the
   * pre-render carrier that would remove it.
   */
  mode: ProjectMode;
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
  const [mode, setMode] = useState<ProjectMode>("arrangement");
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
            mute: t.mute,
            solo: t.solo,
          })),
        );
        setHasStrudel(!!p.strudel);
        setMode(p.mode);
      })
      .catch(() => {
        // No doc: reset what is derived from it.
        if (!alive) return;
        setHasStrudel(false);
        setDocTracks([]);
        setMixerStrips([]);
        // NOT the mode. A doc that failed to compile says nothing about the folder's shape, and
        // snapping a live project back to a timeline on a transient error would move the screen
        // under someone who was only mid-edit in chains.yaml.
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
    mode,
    midiSeqRef,
  };
}
