// useProjectDoc.ts — the compiled doc's slice of shell state, refetched on reloadKey.
// The doc drives the viewport gate (hasVideo), the strudel poll gate, the track order
// the engine meters index by, the mixer state for the track-node controls, and the
// recording overlay's fields. Extracted from App.tsx; behaviour unchanged.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export interface RecInfo {
  tempo: number;
  beatsPerBar: number;
  countIn: number;
  names: Record<string, string>;
}

export interface DocTrack {
  id: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  // Set while the track plays a render of itself. `track freeze` is a toggle, so this is what tells the two
  // directions apart before the command runs — only the freezing one takes a render's worth of time.
  frozen: boolean;
}

export interface ProjectDocState {
  trackOrder: string[];
  metronomeOn: boolean;
  recInfo: RecInfo;
  docTracks: DocTrack[];
  hasVideo: boolean;
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
    /** Called with the project's name when it has video, null when it hasn't. */
    onVideo: (projectName: string | null) => void;
  },
): ProjectDocState {
  const [trackOrder, setTrackOrder] = useState<string[]>([]);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [recInfo, setRecInfo] = useState<RecInfo>({
    tempo: 120,
    beatsPerBar: 4,
    countIn: 0,
    names: {},
  });
  const [docTracks, setDocTracks] = useState<DocTrack[]>([]);
  const [hasVideo, setHasVideo] = useState(false);
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
        setTrackOrder(p.tracks.map((t) => t.id));
        setMetronomeOn(p.metronome);
        setRecInfo({
          tempo: p.tempo,
          beatsPerBar: p.timeSigNumerator || 4,
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
            frozen: !!t.frozen,
          })),
        );
        setHasVideo(!!p.video);
        setHasStrudel(!!p.strudel);
        optsRef.current.onVideo(p.video ? p.name : null);
      })
      .catch(() => {
        // No doc: reset what is derived from it, but do NOT touch the view — only a loaded video-less doc does that.
        if (!alive) return;
        setHasVideo(false);
        setHasStrudel(false);
        setDocTracks([]);
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
    hasVideo,
    hasStrudel,
    midiSeqRef,
  };
}
