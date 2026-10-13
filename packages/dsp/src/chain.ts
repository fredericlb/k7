// chain.ts — the handles a graph builder hands back, each able to carry on the chain: `input(0).mul(mix).out()`.
// A reader would get wrong that chaining changes the graph: each method is the builder call it names, in call order.

import type { Audio, GraphBuilder, Input, Midi, Scalar } from "./index";

/** A control-rate handle; its methods take scalars only, so an audio wire still cannot pass for a parameter. */
export class ScalarNode implements Scalar {
  readonly rate = "control" as const;
  readonly #g: GraphBuilder;
  constructor(
    readonly name: string,
    g: GraphBuilder,
  ) {
    this.#g = g;
  }
  add(b: Input): ScalarNode {
    return this.#g.add(this, b);
  }
  sub(b: Input): ScalarNode {
    return this.#g.sub(this, b);
  }
  mul(b: Input): ScalarNode {
    return this.#g.mul(this, b);
  }
  /** `a − this`: the reversed subtraction, as in `mix.from(1)` for a crossfade's other side. */
  from(a: Input): ScalarNode {
    return this.#g.sub(a, this);
  }
  todb(): ScalarNode {
    return this.#g.todb(this);
  }
  fromdb(): ScalarNode {
    return this.#g.fromdb(this);
  }
  glide(): ScalarNode {
    return this.#g.glide(this);
  }
  clamp(lo: Input, hi: Input): ScalarNode {
    return this.#g.clamp(this, lo, hi);
  }
  linmap(lo: Input, hi: Input): ScalarNode {
    return this.#g.linmap(this, lo, hi);
  }
}

/** An audio-wire handle: `mul` and `add` are the wire nodes `amul` and `aadd`, so a scalar is accepted as the other side. */
export class AudioNode implements Audio {
  readonly rate = "audio" as const;
  readonly #g: GraphBuilder;
  constructor(
    readonly name: string,
    g: GraphBuilder,
  ) {
    this.#g = g;
  }
  mul(b: Audio | Input): AudioNode {
    return this.#g.amul(this, b);
  }
  add(b: Audio | Input): AudioNode {
    return this.#g.aadd(this, b);
  }
  saturate(drive: Input = 1): AudioNode {
    return this.#g.saturate(this, drive);
  }
  delay(timeMs: Input | Audio, maxMs: number, into?: Audio): AudioNode {
    return this.#g.delay(this, timeMs, maxMs, into);
  }
  allpass(baseHz: Input, octaves?: Audio, into?: Audio): AudioNode {
    return this.#g.allpass(this, baseHz, octaves, into);
  }
  /** Sends this wire to the graph's output, and ends the chain. */
  out(): void {
    this.#g.output(this);
  }
}

/** The note stream's handle: the one stream, rewritten in place, so every method hands back the same stream. */
export class MidiNode implements Midi {
  readonly rate = "midi" as const;
  readonly #g: GraphBuilder;
  constructor(g: GraphBuilder) {
    this.#g = g;
  }
  transpose(semitones: Input): MidiNode {
    return this.#g.transpose(this, semitones);
  }
  velocity(scale: Input): MidiNode {
    return this.#g.velocity(this, scale);
  }
  channel(ch: Input): MidiNode {
    return this.#g.channel(this, ch);
  }
  hold(): MidiNode {
    return this.#g.hold(this);
  }
  strike(stepBeats: Input, gate: Input): MidiNode {
    return this.#g.strike(this, stepBeats, gate);
  }
  pattern(mode: Input, length: Input, density: Input, rotate: Input): MidiNode {
    return this.#g.pattern(this, mode, length, density, rotate);
  }
  accent(count: Input, low: Input, opposite: Input, keep: Input): MidiNode {
    return this.#g.accent(this, count, low, opposite, keep);
  }
  chance(p: Input): MidiNode {
    return this.#g.chance(this, p);
  }
  decay(d: Input): MidiNode {
    return this.#g.decay(this, d);
  }
}
