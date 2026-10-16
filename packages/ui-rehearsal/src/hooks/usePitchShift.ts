// usePitchShift.ts — transposing the reference track without slowing it down, through Signalsmith Stretch
// in LIVE INPUT mode, where the playback rate is ignored by construction: only the pitch moves.
// What reads wrong: the element's source lives in one context for good (a media element gives it once),
// while the stretcher lives in a SECOND context closed at zero, since a worklet runs as long as its context.
// It takes the ELEMENT, not a ref, so it sees one appear later. See ../../docs/audio.md.
/// <reference path="../types/signalsmith-stretch.d.ts" />

import { useEffect, useRef } from "react";
import type { StretchNode } from "signalsmith-stretch";

/** The element's own graph, built on the first semitone and kept for the element's life. */
interface Tap {
  el: HTMLAudioElement;
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
}

/** The stretcher, alive only while the shift is not zero. */
interface Shifter {
  ctx: AudioContext;
  node: StretchNode;
  bridge: MediaStreamAudioDestinationNode;
}

/** Play `el` shifted by `semitones`, its tempo untouched. Zero means no stretcher runs. */
export function usePitchShift(
  el: HTMLAudioElement | null,
  semitones: number,
): void {
  const tap = useRef<Tap | null>(null);
  const shifter = useRef<Shifter | null>(null);
  const building = useRef(false);
  // The latest ask, read by the async build so a fast +++ lands on the last value rather than the first.
  const wanted = useRef(semitones);
  wanted.current = semitones;

  useEffect(() => {
    if (!el) return;
    // A graph belongs to the element it was built on: another element starts from nothing.
    if (tap.current && tap.current.el !== el) {
      closeShifter(shifter);
      void tap.current.ctx.close();
      tap.current = null;
    }
    // Nothing built and nothing asked: the element plays itself, which is the cheapest thing there is.
    if (!tap.current && semitones === 0) return;
    if (!tap.current) {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(el);
      source.connect(ctx.destination);
      tap.current = { el, ctx, source };
    }
    const t = tap.current;

    const apply = async (): Promise<void> => {
      const shift = wanted.current;
      if (shift === 0) {
        if (!shifter.current) return;
        t.source.disconnect();
        t.source.connect(t.ctx.destination);
        closeShifter(shifter);
        return;
      }
      if (shifter.current) {
        shifter.current.node.schedule({ semitones: shift });
        return;
      }
      if (building.current) return;
      building.current = true;
      try {
        const built = await buildShifter(t);
        // Unmounted, moved to another element, or back to zero while the WASM loaded: keep nothing.
        if (tap.current !== t || wanted.current === 0) {
          void built.ctx.close();
        } else {
          t.source.disconnect();
          t.source.connect(built.bridge);
          shifter.current = built;
        }
      } finally {
        building.current = false;
      }
      // The ask may have moved while building: settle on the latest one.
      if (tap.current === t) await apply();
    };
    void apply();
  }, [el, semitones]);

  // A context born outside a gesture starts suspended; pressing play is the gesture that frees it.
  useEffect(() => {
    if (!el) return;
    const resume = () => {
      void tap.current?.ctx.resume();
      void shifter.current?.ctx.resume();
    };
    el.addEventListener("play", resume);
    return () => el.removeEventListener("play", resume);
  }, [el]);

  // Closed on unmount only: rebuilding per render would cost a media source the element cannot give twice.
  useEffect(
    () => () => {
      closeShifter(shifter);
      void tap.current?.ctx.close();
      tap.current = null;
    },
    [],
  );
}

/** The stretcher in its own context, fed from the element's through a MediaStream. */
async function buildShifter(t: Tap): Promise<Shifter> {
  const { default: SignalsmithStretch } = await import("signalsmith-stretch");
  const ctx = new AudioContext();
  const node = await SignalsmithStretch(ctx);
  const bridge = t.ctx.createMediaStreamDestination();
  ctx.createMediaStreamSource(bridge.stream).connect(node);
  node.connect(ctx.destination);
  node.start();
  void ctx.resume();
  void t.ctx.resume();
  return { ctx, node, bridge };
}

function closeShifter(ref: { current: Shifter | null }) {
  if (!ref.current) return;
  ref.current.node.stop();
  void ref.current.ctx.close();
  ref.current = null;
}
