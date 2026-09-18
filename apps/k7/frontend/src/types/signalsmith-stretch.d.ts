// signalsmith-stretch ships no TypeScript types. Declare the factory and the members the
// pitch-shift hook actually calls; the library's own README documents the rest.

declare module "signalsmith-stretch" {
  /** An AudioNode with the stretcher's controls bolted on. */
  export interface StretchNode extends AudioNode {
    start(when?: number): void;
    stop(when?: number): void;
    /** In LIVE INPUT mode `rate` and `input` are ignored, which is what keeps the tempo put. */
    schedule(change: {
      output?: number;
      active?: boolean;
      semitones?: number;
      tonalityHz?: number;
      formantSemitones?: number;
      formantCompensation?: boolean;
    }): void;
    /** Live-input latency in seconds — what the sound trails the element's own clock by. */
    latency(): number;
    configure(options: {
      blockMs?: number | null;
      intervalMs?: number;
      splitComputation?: boolean;
      preset?: "default" | "cheaper";
    }): void;
  }

  export default function SignalsmithStretch(
    context: BaseAudioContext,
    channelOptions?: AudioWorkletNodeOptions,
  ): Promise<StretchNode>;
}
