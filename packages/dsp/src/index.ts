// @studio/dsp — write a module's DSP in JS, emit the graph the engine runs.
//
// The JS runs as a BUILD step and produces JSON; it never goes near the audio thread. Throughput was never the
// obstacle (a JS auto-wah measures 0.1% of a 5.3 ms block) — a GC pause is, and no amount of care removes it.
// So this library's whole job is to make a description pleasant to write and impossible to mistype. What runs
// is C++, over the primitives in engine/DspGraph.h.
//
// The value over hand-writing the JSON is what a language gives you: names instead of string literals, numbers
// checked by the compiler, loops and helpers for the repetitive parts, and reuse — a `wah()` you call twice with
// different bounds rather than a file you copy.

// Scalar, Audio and Midi are DIFFERENT TYPES, and that is not decoration — see ../docs/builder.md.

/** A control-rate value: a parameter, a literal, or the output of a once-per-block node. */
export interface Scalar {
  readonly name: string;
  readonly rate: "control";
}

/** An audio wire: one stereo frame, live only inside the per-sample loop. */
export interface Audio {
  readonly name: string;
  readonly rate: "audio";
}

/** Anything a control input accepts. */
export type Input = Scalar | number;

/** The note stream. Exactly ONE per graph, rewritten in place, so it carries no name and cannot be forked. */
export interface Midi {
  readonly rate: "midi";
}

/** @deprecated kept so older graphs still typecheck; prefer Scalar or Audio. */
export type Signal = Scalar;

export interface ParamSpec {
  min: number;
  max: number;
  default: number;
  /** Two or more labels make it a dropdown rather than a knob. */
  labels?: string[];
}

interface NodeJson {
  type: string;
  in?: (string | number)[];
  /** Sample-phase nodes only: their SCALAR inputs, kept apart from the audio wires in `in`. */
  k?: (string | number)[];
  /** `ain` only: which of the module's input PORTS to read. Absent is the first (the chain's flow). */
  port?: number;
  out?: string;
  mode?: string;
  shape?: string;
  maxMs?: number;
}

export interface GraphJson {
  params: ({ name: string } & ParamSpec)[];
  nodes: NodeJson[];
}

/** The sample rate, readable inside a graph — a Nyquist limit needs it and no literal can express it. */
export const sr: Scalar = { name: "sr", rate: "control" };

/** Build a graph. Every helper is a method because a node is RECORDED as well as returned — ../docs/builder.md. */
export class GraphBuilder {
  private readonly json: GraphJson = { params: [], nodes: [] };
  private counter = 0;

  /** The sample rate. On the BUILDER too, because a module's source imports nothing at runtime. */
  readonly sr: Scalar = sr;

  /** Declare a parameter. The returned signal reads it; the module exposes it as a knob or a dropdown. */
  param(name: string, spec: ParamSpec): Scalar {
    if (this.json.params.some((p) => p.name === name))
      throw new Error(`duplicate param: ${name}`);
    this.json.params.push({ name, ...spec });
    return { name, rate: "control" };
  }

  private node(type: string, ins: Input[], mode?: string): Scalar {
    const out = `n${this.counter++}`;
    const n: NodeJson = {
      type,
      in: ins.map((i) => (typeof i === "number" ? i : i.name)),
      out,
    };
    if (mode) n.mode = mode;
    this.json.nodes.push(n);
    return { name: out, rate: "control" };
  }

  // A node that transforms the AUDIO writes no scalar, so it gets no output signal.
  private sink(type: string, ins: Input[], mode?: string): void {
    const n: NodeJson = {
      type,
      in: ins.map((i) => (typeof i === "number" ? i : i.name)),
    };
    if (mode) n.mode = mode;
    this.json.nodes.push(n);
  }

  // --- analysis: per sample over the input ---------------------------------

  /** Peak envelope of the incoming audio, in linear gain. Times in milliseconds. */
  envelope(attackMs: Input, releaseMs: Input): Scalar {
    return this.node("envelope", [attackMs, releaseMs]);
  }

  // --- control: once per block ----------------------------------------------

  /** Linear gain -> dB, floored at -100. */
  todb(x: Input): Scalar {
    return this.node("todb", [x]);
  }
  /** dB -> linear gain: todb's inverse, and what turns a computed level into something `gain` can use. */
  fromdb(x: Input): Scalar {
    return this.node("fromdb", [x]);
  }
  /** a + t·(b − a). */
  lerp(a: Input, b: Input, t: Input): Scalar {
    return this.node("lerp", [a, b, t]);
  }
  /** Where `x` sits between `lo` and `hi`, as 0..1, clamped. Swap lo/hi to invert. */
  linmap(x: Input, lo: Input, hi: Input): Scalar {
    return this.node("linmap", [x, lo, hi]);
  }
  /** Geometric interpolation, for Hz. `lo` must be the LOW end: a descending pair is refused — ../docs/builder.md. */
  geolerp(lo: Input, hi: Input, t: Input): Scalar {
    if (typeof lo === "number" && typeof hi === "number" && lo > hi)
      throw new Error(
        `geolerp(${lo}, ${hi}) is descending — the engine sorts its ends, so this would read as ` +
          `geolerp(${hi}, ${lo}) and sweep the wrong way. Invert t instead: geolerp(${hi}, ${lo}, sub(1, t)).`,
      );
    return this.node("geolerp", [lo, hi, t]);
  }
  clamp(x: Input, lo: Input, hi: Input): Scalar {
    return this.node("clamp", [x, lo, hi]);
  }
  /** `pick` >= 0.5 chooses `b`, else `a`. */
  select(a: Input, b: Input, pick: Input): Scalar {
    return this.node("select", [a, b, pick]);
  }
  add(a: Input, b: Input): Scalar {
    return this.node("add", [a, b]);
  }
  sub(a: Input, b: Input): Scalar {
    return this.node("sub", [a, b]);
  }
  mul(a: Input, b: Input): Scalar {
    return this.node("mul", [a, b]);
  }
  /** One-pole smoothing ACROSS blocks — what stops a per-block coefficient jump from zippering. */
  glide(x: Input): Scalar {
    return this.node("glide", [x]);
  }

  // --- audio: per sample, transforming the buffer ---------------------------
  biquad(
    mode: "bandpass" | "lowpass" | "highpass" | "notch",
    freq: Input,
    q: Input,
  ): void {
    this.sink("biquad", [freq, q], mode);
  }
  gain(amount: Input): void {
    this.sink("gain", [amount]);
  }
  /** Blend the graph's output back with what came in: 1 is fully wet. */
  mix(wet: Input): void {
    this.sink("mix", [wet]);
  }

  // --- sample rate: audio wires, and the feedback the block phases cannot express -------------------------

  // One per-sample loop in declared order, so reading a LATER node's wire is the unit delay — ../docs/builder.md.

  /** Name a wire before anything writes it — how a feedback loop is drawn; the name is the whole mechanism. */
  wire(name: string): Audio {
    return { name, rate: "audio" };
  }

  /** An incoming signal, as a wire. `port` indexes the module's own inputs — packages/song/docs/ports.md. */
  input(port = 0): Audio {
    const out = `n${this.counter++}`;
    // The first port emits no field at all, so every graph written before ports existed is byte-identical.
    this.json.nodes.push({ type: "ain", ...(port > 0 ? { port } : {}), out });
    return { name: out, rate: "audio" };
  }

  /** A low-frequency oscillator, -1..1, at SAMPLE rate so it cannot zipper — scale it with `amul`/`aadd`. */
  lfo(shape: "sine" | "triangle" | "saw" | "square", rateHz: Input): Audio {
    const out = `n${this.counter++}`;
    this.json.nodes.push({
      type: "alfo",
      k: [typeof rateHz === "number" ? rateHz : rateHz.name],
      out,
      shape,
    });
    return { name: out, rate: "audio" };
  }
  /** Send a wire to the output. */
  output(x: Audio): void {
    this.json.nodes.push({ type: "aout", in: [x.name] });
  }
  /** Multiply two wires, or a wire by a scalar. */
  amul(a: Audio, b: Audio | Input): Audio {
    return typeof b !== "number" && b.rate === "audio"
      ? this.anode("amul", [a, b], [])
      : this.anode("amul", [a], [b]);
  }
  /** Add two wires, or a scalar offset to a wire — the engine's node has always taken either. */
  aadd(a: Audio, b: Audio | Input): Audio {
    return typeof b !== "number" && b.rate === "audio"
      ? this.anode("aadd", [a, b], [])
      : this.anode("aadd", [a], [b]);
  }
  /** tanh saturation — what keeps a feedback loop musical instead of divergent. */
  saturate(x: Audio, drive: Input = 1): Audio {
    return this.anode("atanh", [x], [drive]);
  }
  /** A delay line. `maxMs` is allocated once at prepare, so it is a ceiling rather than a suggestion. */
  delay(x: Audio, timeMs: Input | Audio, maxMs: number, into?: Audio): Audio {
    const out = into ? into.name : `n${this.counter++}`;
    // A modulating WIRE goes in the audio slot (read per sample); a fixed time stays a scalar.
    const modulated = typeof timeMs !== "number" && timeMs.rate === "audio";
    this.json.nodes.push({
      type: "adelay",
      in: modulated ? [x.name, (timeMs as Audio).name] : [x.name],
      ...(modulated
        ? {}
        : { k: [typeof timeMs === "number" ? timeMs : timeMs.name] }),
      out,
      maxMs,
    });
    return { name: out, rate: "audio" };
  }

  // A sample-phase node: AUDIO wires in `in`, scalars in `k`. The split is the whole point of the two types.
  private anode(type: string, ins: Audio[], ks: Input[]): Audio {
    const out = `n${this.counter++}`;
    const n: NodeJson = { type, out };
    if (ins.length) n.in = ins.map((i) => i.name);
    if (ks.length) n.k = ks.map((i) => (typeof i === "number" ? i : i.name));
    this.json.nodes.push(n);
    return { name: out, rate: "audio" };
  }

  // --- MIDI ---------------------------------------------------------------

  // Once per block over the note list, on the SAME builder because a MIDI module still declares parameters.

  /** The incoming note stream. */
  midi(): Midi {
    return { rate: "midi" };
  }

  /** Shift every note by `semitones`, rounded. Notes past the keyboard's ends are clamped, never dropped. */
  transpose(m: Midi, semitones: Input): Midi {
    this.mnode("transpose", semitones);
    return m;
  }

  /** Scale note-on velocities. Never reaches zero — velocity 0 is a note-off in MIDI. */
  velocity(m: Midi, scale: Input): Midi {
    this.mnode("velocity", scale);
    return m;
  }

  /** Force every message onto one channel (1..16). */
  channel(m: Midi, ch: Input): Midi {
    this.mnode("mchannel", ch);
    return m;
  }

  // A MIDI node takes SCALARS and no wires, hence no `out`: it acts on the plugin's buffer, not on a value.
  private mnode(type: string, k: Input): void {
    // A literal goes through as a NUMBER, not its text — ../docs/builder.md on the engine's ref().
    this.json.nodes.push({ type, in: [typeof k === "number" ? k : k.name] });
  }

  build(): GraphJson {
    return this.json;
  }
  toJSON(): string {
    return JSON.stringify(this.json, null, 2);
  }
}

/** Write a graph. `fn` receives the builder; the return value is the description. */
export function graph(fn: (g: GraphBuilder) => void): GraphJson {
  const g = new GraphBuilder();
  fn(g);
  return g.build();
}
