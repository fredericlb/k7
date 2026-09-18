// usePitchShift.ts — transposing the reference track without slowing it down. The element's sound
// is routed through Signalsmith Stretch in LIVE INPUT mode, where the playback rate is ignored by
// construction: only the pitch moves, never the tempo.
//
// Built on demand and BYPASSED at zero, so a song nobody transposes pays neither the latency nor
// the CPU. What reads wrong: a media element may be given a source node only once, so the graph is
// kept for the element's whole life. See ../../docs/audio.md.

import { useEffect, useRef } from "react";
import type { StretchNode } from "signalsmith-stretch";

interface Graph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  node: StretchNode;
}

/** Play `element` shifted by `semitones`, its tempo untouched. Zero means the browser plays it raw. */
export function usePitchShift(
  element: React.RefObject<HTMLAudioElement | null>,
  semitones: number,
): void {
  const graph = useRef<Graph | null>(null);
  // The latest ask, read by the async build so a fast +++ lands on the last value rather than the first.
  const wanted = useRef(semitones);
  wanted.current = semitones;

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    // Nothing built and nothing asked: the element plays itself, which is the cheapest thing there is.
    if (!graph.current && semitones === 0) return;

    let alive = true;

    const wire = (g: Graph) => {
      const shift = wanted.current;
      g.source.disconnect();
      g.node.disconnect();
      if (shift === 0) {
        g.source.connect(g.ctx.destination);
        return;
      }
      g.source.connect(g.node);
      g.node.connect(g.ctx.destination);
      g.node.schedule({ semitones: shift });
    };

    if (graph.current) {
      wire(graph.current);
      return;
    }

    void (async () => {
      const { default: SignalsmithStretch } = await import(
        "signalsmith-stretch"
      );
      const ctx = new AudioContext();
      const node = await SignalsmithStretch(ctx);
      // Unmounted while the WASM loaded: build nothing, and leave no context running.
      if (!alive) {
        void ctx.close();
        return;
      }
      node.start();
      graph.current = { ctx, source: ctx.createMediaElementSource(el), node };
      wire(graph.current);
    })();

    return () => {
      alive = false;
    };
  }, [element, semitones]);

  // A context born outside a gesture starts suspended; pressing play is the gesture that frees it.
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const resume = () => void graph.current?.ctx.resume();
    el.addEventListener("play", resume);
    return () => el.removeEventListener("play", resume);
  }, [element]);

  // Closed on unmount only: rebuilding per render would cost a media source the element cannot give twice.
  useEffect(
    () => () => {
      void graph.current?.ctx.close();
      graph.current = null;
    },
    [],
  );
}
